"""The hierarchy itself: node refs, children, connections, and the bounded context reads."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.bridge.deps import Ws
from codechroma.bridge.workspaces import Workspace
from codechroma.config import settings
from codechroma.context import structure
from codechroma.context.digest import build_context_digest
from codechroma.dependencies.digest import build_dependency_index, find_route
from codechroma.engine import ROOT_SENTINEL
from codechroma.graph.models import HierarchyLevel, HierarchyNode
from codechroma.io import read_text, safe_read_within, slice_lines

router = APIRouter()

ROOT_NODE_ID = "root"

_LEVEL_MAP = {
    HierarchyLevel.SYSTEM: "folder",
    HierarchyLevel.PILLAR: "folder",
    HierarchyLevel.COMPONENT: "file",
    HierarchyLevel.SERVICE: "class",
    HierarchyLevel.FUNCTION: "function",
}

def _language_by_suffix() -> dict[str, str]:
    """Derived from the analyzers at import, so the map can't drift from what actually parses."""
    registry = AnalyzerRegistry.with_defaults()
    parsed = {
        ext: analyzer.language
        for ext in registry.supported_extensions()
        if (analyzer := registry.for_file(f"x{ext}")) is not None
    }
    # Extensions no analyzer claims -- still worth a language tag for the UI's syntax highlighting.
    return parsed | {".yaml": "yaml", ".yml": "yaml"}


_LANGUAGE_BY_SUFFIX = _language_by_suffix()


def language_for(file_path: str) -> str | None:
    # .md isn't analyzable but has a highlighter, so tag it (others come from _LANGUAGE_BY_SUFFIX).
    if Path(file_path).suffix in (".md", ".markdown"):
        return "markdown"
    return _LANGUAGE_BY_SUFFIX.get(Path(file_path).suffix)


def _cached_read_text(ws: Workspace, source_path: str, cache: dict[str, str | None]) -> str | None:
    """Reads a file at most once per cache -- siblings sharing a file (e.g. methods) reuse it."""
    if source_path not in cache:
        cache[source_path] = read_text(ws.root / source_path)
    return cache[source_path]


def _node_source(
    ws: Workspace, node: HierarchyNode, cache: dict[str, str | None]
) -> tuple[str | None, str | None]:
    if node.level == HierarchyLevel.COMPONENT:
        if not node.source_path:
            return None, None
        return _cached_read_text(ws, node.source_path, cache), language_for(node.source_path)

    if node.level in (HierarchyLevel.SERVICE, HierarchyLevel.FUNCTION):
        symbol = ws.engine.get_symbol(node.id)
        if symbol is None or not node.source_path:
            return None, None
        text = _cached_read_text(ws, node.source_path, cache)
        if text is None:
            return None, None
        source = slice_lines(text, symbol.start_line, symbol.end_line)
        # The analyzer stamped this at parse time -- no need to re-derive it from the suffix.
        return source, symbol.language

    return None, None


def visible_children(ws: Workspace, node_id: str) -> list[HierarchyNode]:
    if node_id != ROOT_SENTINEL:
        parent = ws.engine.get_node(node_id)
        if parent is not None and parent.level == HierarchyLevel.FUNCTION:
            return []
    children = ws.engine.get_children(node_id)
    return [child for child in children if child.level != HierarchyLevel.CODE]


def to_ref(ws: Workspace, node: HierarchyNode, cache: dict[str, str | None]) -> dict:
    children = visible_children(ws, node.id)
    source, language = _node_source(ws, node, cache)
    return {
        "node_id": node.id,
        "name": node.name,
        "level": _LEVEL_MAP[node.level],
        "parent_id": node.parent_ids[0] if node.parent_ids else ROOT_NODE_ID,
        "has_children": len(children) > 0,
        "child_count": len(children),
        "source": source,
        "language": language,
        "doc_only": node.doc_only,
    }


def _root_ref(ws: Workspace) -> dict:
    children = visible_children(ws, ROOT_SENTINEL)
    return {
        "node_id": ROOT_NODE_ID,
        "name": ws.root.name,
        "level": "folder",
        "parent_id": None,
        "has_children": len(children) > 0,
        "child_count": len(children),
    }


@router.get("/repos/{repo_id}/context-digest")
def get_context_digest(ws: Ws) -> dict:
    """Token-efficient project summary an AI assistant reads instead of re-grepping the repo."""
    return build_context_digest(ws.engine, ws.root)


@router.get("/repos/{repo_id}/structure")
def get_structure(
    ws: Ws,
    root: str = ROOT_NODE_ID,
    depth: int = settings.structure.default_depth,
    max_children: int = settings.structure.default_max_children,
    max_nodes: int = settings.structure.default_max_nodes,
) -> dict:
    """Bounded folder/file tree with real node ids — the verified paths a C1 author copies from."""
    ws.sync()
    # An UnknownRootError becomes a 404 via the table in bridge/errors.py.
    return structure.build_structure(ws.engine, root, depth, max_children, max_nodes)


@router.get("/repos/{repo_id}/dependency-digest")
def get_dependency_digest(ws: Ws, path: str | None = None) -> dict:
    """Persisted file/class/function call digest, refreshed on every analyze/reanalyze."""
    ws.sync()
    digest = ws.load_dependency_digest()
    if path is None:
        return digest
    for file_entry in digest.get("files", []):
        if file_entry.get("path") == path:
            return file_entry
    raise HTTPException(status_code=404, detail=f"no digest entry for path {path!r}")


# Within this group order matters: `{node_id:path}` alone would swallow `.../children`.
@router.get("/repos/{repo_id}/nodes/{node_id:path}/children")
def get_children(ws: Ws, node_id: str) -> list[dict]:
    parent_id = ROOT_SENTINEL if node_id == ROOT_NODE_ID else node_id
    cache: dict[str, str | None] = {}
    return [to_ref(ws, child, cache) for child in visible_children(ws, parent_id)]


@router.get("/repos/{repo_id}/nodes/{node_id:path}/connections")
def get_connections(ws: Ws, node_id: str) -> list[dict]:
    dependencies = ws.engine.get_dependencies(node_id)
    dependents = ws.engine.get_dependents(node_id)
    # The caller's origin is the node itself — identical for every outgoing edge.
    origin = ws.engine.edge_origin(node_id)
    connections = [
        {"from_id": node_id, "to_id": dep.id, "from_to": "depends_on", "origin": origin}
        for dep in dependencies
    ]
    connections += [
        {
            "from_id": dep.id,
            "to_id": node_id,
            "from_to": "depended_on_by",
            "origin": ws.engine.edge_origin(dep.id),
        }
        for dep in dependents
    ]
    return connections


@router.get("/repos/{repo_id}/route")
def get_route(
    ws: Ws, from_id: str = Query(alias="from"), to_id: str = Query(alias="to")
) -> dict:
    """Dependency path between two selected nodes -- built fresh, not from the capped digest."""
    index = build_dependency_index(ws.engine.snapshot())
    return {"path": find_route(index, from_id, to_id)}


@router.get("/repos/{repo_id}/nodes/{node_id:path}")
def get_node(ws: Ws, node_id: str) -> dict:
    if node_id == ROOT_NODE_ID:
        return _root_ref(ws)
    node = ws.engine.get_node(node_id)
    # A real 404, not 200/null: a null body reads identically to "hasn't arrived yet" client-side.
    if node is None or node.level == HierarchyLevel.CODE:
        raise HTTPException(status_code=404, detail=f"unknown node: {node_id}")
    return to_ref(ws, node, {})


@router.get("/repos/{repo_id}/source")
def get_source_fragment(
    ws: Ws, path: str, start: int | None = None, end: int | None = None
) -> dict:
    """A file slice by 1-based inclusive `[start, end]` line range (both optional — absent is the
    whole file). Serves an epics block's source links with the same `read_text`/`slice_lines` path
    the node inspector uses; the path is confined to the workspace root."""
    text = safe_read_within(ws.root, ws.root / path)
    if text is None:
        raise HTTPException(status_code=404, detail=f"unknown file: {path}")
    if start is None and end is None:
        content = text
    else:
        # `end` is optional: slice_lines' `splitlines()[a:b]` closes on its own when `end` is None,
        # so no separate line count is needed here.
        content = slice_lines(text, start or 1, end)
    return {"path": path, "content": content, "language": language_for(path)}
