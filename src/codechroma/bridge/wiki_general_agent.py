"""Builds the wiki-general SkillAgent -- a standalone function, not diagrams/registry.py.

wiki-general (docs/planning/047-wiki-general/047-wiki-general.md) is a tree of markdown pages, not a
canvas diagram, so it deliberately does not go through DiagramTypeDefinition/BUILTIN_TYPES the way
c1/patterns/impact/custom do -- see docs/architecture/diagram-skills.md's diagram-registry section
and [[diagram-unification-scope-boundary]] for why forcing a different data source into that shape
is the wrong reuse. What *is* reused is the SkillAgent primitive itself (snapshot/restore/timeout/
cancel/streaming), following content_generators.py::build_skill_agent_for's pattern one level down.

SkillAgent.has_artifact() always `json.loads()`s the artifact file (skill_agent.py), so the file
this runner snapshots/restores/validates has to be JSON even though the skill's real output is
markdown pages. `.codechroma/wiki-general/manifest.json` is that bookkeeping file -- written last,
after every page -- never meant for a human to read, the same role `.hashtree.json` plays for the
plain wiki.
"""

from __future__ import annotations

import asyncio
import re
import shutil
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.bridge.skill_agent import SkillAgent, build_skill_agent
from codechroma.bridge.wiki_general_naming import dedupe_id, deterministic_name
from codechroma.dependencies.clustering import (
    ClusterEdge,
    ClusterResult,
    aggregate_edges,
    build_clusters,
    plurality_winner,
    undetermined_candidates,
)
from codechroma.engine import IGNORED_DIRS
from codechroma.graph.builder import DOC_EXTENSIONS
from codechroma.io import load_json_or_none, write_json
from codechroma.prompts import render_prompt

if TYPE_CHECKING:
    from codechroma.bridge.workspaces import Workspace

KIND = "wiki-general"
# A second, narrower runner that patches only affected pages -- see wiki-general.md's commit part.
KIND_UPDATE = "wiki-general-update"

# DOC_EXTENSIONS (graph/builder.py) plus data/config formats no analyzer treats as real code either.
_NON_CODE_EXTENSIONS = DOC_EXTENSIONS | {".json", ".yml", ".yaml"}

# Same generated/vendored dirs engine.py's own repo walk skips, plus two this repo doesn't have.
_IGNORED_DIR_NAMES = IGNORED_DIRS | {"vendor", "target"}

NO_DOCUMENTABLE_CONTENT_ERROR = "repository has no code yet -- nothing to document"

# prepare_new_run's "a run is already in flight" signal -- distinct from a real error message.
ALREADY_RUNNING = "__wiki_general_already_running__"

# Kept in sync by hand with codechroma-wiki-general-update/scripts/check_wiki_general.py's _REF_RE.
_REF_RE = re.compile(r"^\s*-\s+(?:File|Class|Function):\s+`([^`]+)`\s*$", re.MULTILINE)

# Shared by both routes that can start a run -- closes the "is the other kind running?" race.
_run_locks: dict[str, asyncio.Lock] = {}


def run_lock(ws_id: str) -> asyncio.Lock:
    """The lock generate/update both hold across their refuse-check-then-start sequence."""
    return _run_locks.setdefault(ws_id, asyncio.Lock())


def wiki_general_dir(root: Path, _repo_id: str) -> Path:
    return root / ".codechroma" / "wiki-general"


def wiki_general_manifest_path(root: Path, repo_id: str) -> Path:
    return wiki_general_dir(root, repo_id) / "manifest.json"


def clear_wiki_general(root: Path, repo_id: str) -> None:
    """Full-replace before a new run -- `c2`/`c3` come back empty, no subagent has to `mkdir`."""
    directory = wiki_general_dir(root, repo_id)
    shutil.rmtree(directory, ignore_errors=True)
    (directory / "c2").mkdir(parents=True, exist_ok=True)
    (directory / "c3").mkdir(parents=True, exist_ok=True)


def sync_plain_wiki(ws: Workspace) -> str | None:
    """Ensures `.codechroma/wiki/` exists and is current; error message on failure, else `None`."""
    try:
        ws.engine.sync_wiki(ws.wiki_index_path.parent)
    except Exception as exc:  # noqa: BLE001 -- reported as a normal generation error, not a crash
        return f"plain wiki sync failed: {exc}"
    return None


# 🔴 Only reachable for a run about to start -- prepare_new_run below is the guard for that.
def _prepare_new_run(ws: Workspace) -> str | None:
    """Blocking half of prepare_new_run -- real file I/O, so it runs in a worker thread."""
    clear_wiki_general(ws.root, ws.id)
    return sync_plain_wiki(ws)


def has_documentable_content(ws: Workspace) -> bool:
    """False if the repo has nothing but a placeholder/doc/config graph -- no run should start."""
    graph = ws.engine.snapshot()
    for symbol in graph.symbols.values():
        if symbol.language == "yaml":
            continue
        if Path(symbol.file_path).suffix.lower() in _NON_CODE_EXTENSIONS:
            continue
        return True
    # No parsed symbol also describes an unsupported-language repo -- a raw scan tells them apart.
    return _has_unparsed_source_file(ws.root)


def _has_unparsed_source_file(root: Path) -> bool:
    """True if any real-looking file sits outside dotfiles/dotdirs and generated/vendored trees."""
    for path in root.rglob("*"):
        if not path.is_file() or path.name.startswith("."):
            continue
        relative_dirs = path.relative_to(root).parts[:-1]
        if any(part.startswith(".") or part in _IGNORED_DIR_NAMES for part in relative_dirs):
            continue
        if path.suffix.lower() in _NON_CODE_EXTENSIONS:
            continue
        return True
    return False


# Shared by both routes that can start a run (button + interactive) -- one guard, not two copies.
async def prepare_new_run(
    agent: SkillAgent, ws: Workspace, *, guard_content: bool = True
) -> str | None:
    """Clears stale pages, readies the plain wiki before a run; ALREADY_RUNNING if one's live."""
    # guard_content=False only for KIND_UPDATE (post-commit trigger implies a prior generate).
    if agent.get_state(ws.id)["state"] == "generating":
        return ALREADY_RUNNING
    if guard_content and not has_documentable_content(ws):
        return NO_DOCUMENTABLE_CONTENT_ERROR
    return await asyncio.to_thread(_prepare_new_run, ws)


def _valid_manifest(data: object) -> bool:
    """Light shape gate only -- check_wiki_general.py's self-check does the real content check."""
    if not isinstance(data, dict):
        return False
    containers, components = data.get("containers"), data.get("components")
    return (
        isinstance(containers, list)
        and bool(containers)
        and isinstance(components, list)
        and bool(components)
        and all(isinstance(c, dict) and isinstance(c.get("id"), str) for c in containers)
        and all(isinstance(c, dict) and isinstance(c.get("id"), str) for c in components)
    )


def build_wiki_general_agent() -> SkillAgent:
    """One `SkillAgent` runner for wiki-general; `run_body` deferred-imported to dodge a cycle."""
    from codechroma.bridge.wiki_general_pipeline import run_pipeline

    return build_skill_agent(
        KIND,
        name="wiki_general_agent",
        # No prompt: run_body (058) replaces _run_cli entirely, so self.prompt is never read.
        artifact=wiki_general_manifest_path,
        validate=_valid_manifest,
        timeout_env_var="codechroma_WIKI_GENERAL_TIMEOUT_SECONDS",
        invalid_error="generation produced no valid wiki-general manifest",
        run_body=run_pipeline,
    )


def build_wiki_general_update_agent() -> SkillAgent:
    """A second runner: patches only affected pages after a commit, never wipes the tree."""
    return build_skill_agent(
        KIND_UPDATE,
        name="wiki_general_update_agent",
        prompt=render_prompt("wiki_general_update_agent"),
        artifact=wiki_general_manifest_path,
        validate=_valid_manifest,
        timeout_env_var="codechroma_WIKI_GENERAL_UPDATE_TIMEOUT_SECONDS",
        invalid_error="update produced no valid wiki-general manifest",
    )


def stamp_generated_commit(ws: Workspace) -> None:
    """Records the HEAD this wiki-general tree reflects, right after a successful run."""
    head = ws.git_sync.current_head()
    if head is None:
        return
    manifest_path = wiki_general_manifest_path(ws.root, ws.id)
    data = load_json_or_none(manifest_path)
    if data is None:
        return
    data["generated_at_commit"] = head
    write_json(manifest_path, data)


def is_stale(ws: Workspace, manifest: dict | None = None) -> bool:
    """Past its built commit? -- reuses the caller's manifest if given, else loads it fresh."""
    data = (
        manifest
        if manifest is not None
        else load_json_or_none(wiki_general_manifest_path(ws.root, ws.id))
    )
    if data is None:
        return False
    head = ws.git_sync.current_head()
    return head is not None and data.get("generated_at_commit") != head


def changed_paths_since_last_run(ws: Workspace, manifest: dict | None) -> set[str]:
    """The update route's real diff base: since generated_at_commit, not since the branch point."""
    base_commit = manifest.get("generated_at_commit") if manifest else None
    return set(ws.changed_since(base_commit))


def find_affected_components(ws: Workspace, changed_paths: set[str]) -> dict:
    """Which c3/<id>.md pages reference a changed path; a path matching none lands in "gaps"."""
    # Never a real "gap" to report -- the bridge's own bookkeeping, not code a page could reference.
    changed_paths = {p for p in changed_paths if ".codechroma" not in Path(p).parts}
    directory = wiki_general_dir(ws.root, ws.id)
    manifest = load_json_or_none(wiki_general_manifest_path(ws.root, ws.id)) or {}
    affected: list[dict] = []
    matched: set[str] = set()
    for component in manifest.get("components", []):
        component_id = component.get("id") if isinstance(component, dict) else None
        # A bare filename only -- manifest ids are model-written; never let one escape c3/ via "..".
        if not isinstance(component_id, str) or component_id != Path(component_id).name:
            continue
        try:
            text = (directory / "c3" / f"{component_id}.md").read_text(encoding="utf-8")
        except OSError:
            continue
        referenced = {ref.split("::", 1)[0] for ref in _REF_RE.findall(text)}
        hit = referenced & changed_paths
        if not hit:
            continue
        matched |= hit
        affected.append({
            "id": component_id,
            "name": component.get("name", component_id),
            "container": component.get("container"),
            "changed_paths": sorted(hit),
        })
    gaps = sorted(changed_paths - matched)
    return {"affected": affected, "gaps": gaps}


def _serialize_edges(edges: list[ClusterEdge]) -> list[dict]:
    return [{"from": edge.from_id, "to": edge.to_id, "count": edge.count} for edge in edges]


def _dict_list(value: object) -> list[dict]:
    return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []


def _entry_ids(entries: list[dict]) -> set[str]:
    return {entry_id for e in entries if isinstance(entry_id := e.get("id"), str)}


def _files_by_old_id(entries: list[dict]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for entry in entries:
        entry_id, files = entry.get("id"), entry.get("files")
        if isinstance(entry_id, str) and isinstance(files, list):
            result[entry_id] = [f for f in files if isinstance(f, str)]
    return result


def _neighbors_from_edge_dicts(edges: list[dict], valid_ids: set[str]) -> dict[str, set[str]]:
    """Neighbor map restricted to `valid_ids` -- keeps a same-named component/container apart."""
    neighbors: dict[str, set[str]] = {}
    for edge in edges:
        from_id, to_id = edge.get("from"), edge.get("to")
        if from_id in valid_ids and to_id in valid_ids:
            neighbors.setdefault(from_id, set()).add(to_id)
            neighbors.setdefault(to_id, set()).add(from_id)
    return neighbors


def _best_matching_old_id(files: list[str], old_id_by_file: dict[str, str]) -> str | None:
    """The old id most of `files` used to belong to; None if empty or a tie (Created wins ties)."""
    votes = Counter(old_id_by_file[f] for f in files if f in old_id_by_file)
    return plurality_winner(votes)


def _diff_level(
    fresh_groups: list[tuple[str, list[str]]],
    old_entries: list[dict],
    old_neighbors: dict[str, set[str]],
    fresh_edges: list[tuple[str, str]],
    used_ids: set[str],
    *, top_level: bool,
) -> tuple[dict, dict[str, str]]:
    """data-model.md's Update state machine for one level; returns (delta, internal_id->real_id)."""
    # Every old id, even a files[]-less one (predates this feature) -- must count as superseded.
    old_ids = _entry_ids(old_entries)
    old_files_by_id = _files_by_old_id(old_entries)
    old_id_by_file = {f: oid for oid, files in old_files_by_id.items() for f in files}

    resolved: dict[str, str] = {}
    matched_old_ids: set[str] = set()
    created: list[dict] = []
    for internal_id, files in fresh_groups:
        match = _best_matching_old_id(files, old_id_by_file)
        if match is not None:
            resolved[internal_id] = match
            matched_old_ids.add(match)
        else:
            new_id, new_name = deterministic_name(files, top_level=top_level)
            new_id = dedupe_id(new_id, used_ids)
            used_ids.add(new_id)
            resolved[internal_id] = new_id
            created.append({
                "id": new_id, "name": new_name, "files": sorted(files), "internal_id": internal_id
            })

    fresh_neighbors_real: dict[str, set[str]] = {}
    for a, b in fresh_edges:
        ra, rb = resolved.get(a), resolved.get(b)
        if ra is None or rb is None:
            continue
        fresh_neighbors_real.setdefault(ra, set()).add(rb)
        fresh_neighbors_real.setdefault(rb, set()).add(ra)

    files_by_internal = dict(fresh_groups)
    unaffected: list[str] = []
    rewritten: list[dict] = []
    for internal_id, real_id in resolved.items():
        if real_id not in matched_old_ids:
            continue  # already recorded in `created`
        files = files_by_internal[internal_id]
        same_files = sorted(files) == sorted(old_files_by_id.get(real_id, []))
        same_neighbors = fresh_neighbors_real.get(real_id, set()) == old_neighbors.get(
            real_id, set()
        )
        if same_files and same_neighbors:
            unaffected.append(real_id)
        else:
            rewritten.append({"id": real_id, "files": sorted(files), "internal_id": internal_id})

    deleted = sorted(old_ids - matched_old_ids)
    delta = {
        "unaffected": sorted(unaffected),
        "rewritten": sorted(rewritten, key=lambda e: e["id"]),
        "created": sorted(created, key=lambda e: e["id"]),
        "deleted": deleted,
    }
    return delta, resolved


def _diff_manifest(fresh: ClusterResult, old_manifest: dict) -> dict:
    """The full Update delta: components then containers, using pass-1's resolved real ids."""
    old_components = _dict_list(old_manifest.get("components"))
    old_containers = _dict_list(old_manifest.get("containers"))
    old_edges = _dict_list(old_manifest.get("edges"))
    # Persisted edges mix both levels; per-level id filtering stops a same-named id colliding.
    used_component_ids = _entry_ids(old_components)
    used_container_ids = _entry_ids(old_containers)
    old_component_neighbors = _neighbors_from_edge_dicts(old_edges, used_component_ids)
    old_container_neighbors = _neighbors_from_edge_dicts(old_edges, used_container_ids)

    component_groups = [(c.id, c.files) for c in fresh.components]
    component_edges = [(e.from_id, e.to_id) for e in fresh.component_edges]
    component_delta, component_resolved = _diff_level(
        component_groups, old_components, old_component_neighbors, component_edges,
        used_component_ids, top_level=False,
    )

    container_files: dict[str, list[str]] = {}
    for component in fresh.components:
        container_files.setdefault(component.container_id, []).extend(component.files)
    container_groups = list(container_files.items())
    container_edges = [(e.from_id, e.to_id) for e in fresh.container_edges]
    container_delta, container_resolved = _diff_level(
        container_groups, old_containers, old_container_neighbors, container_edges,
        used_container_ids, top_level=True,
    )

    component_container_of = {
        c.id: container_resolved[c.container_id] for c in fresh.components
    }
    for entry in component_delta["created"] + component_delta["rewritten"]:
        entry["container"] = component_container_of[entry["internal_id"]]
        del entry["internal_id"]
    for entry in container_delta["created"] + container_delta["rewritten"]:
        del entry["internal_id"]

    edges = _translate_edges(fresh.component_edges, component_resolved)
    edges += _translate_edges(fresh.container_edges, container_resolved)
    return {"components": component_delta, "containers": container_delta, "edges": edges}


def _translate_edges(edges: list[ClusterEdge], resolved: dict[str, str]) -> list[dict]:
    """Fresh internal-id edges, translated to real ids, one entry per unordered real-id pair."""
    aggregated = aggregate_edges(resolved, ((e.from_id, e.to_id, e.count) for e in edges))
    return [{"from": a, "to": b, "count": count} for (a, b), count in sorted(aggregated.items())]


def compute_update_delta(ws: Workspace) -> dict:
    """Recomputes clustering fresh, then diffs it against the stored manifest's state machine."""
    ws.git_sync.sync(ws.engine)  # must reflect right-now, not whenever the watcher last ran
    graph = ws.engine.snapshot()
    registry = AnalyzerRegistry.with_defaults()
    fresh = build_clusters(graph, ws.root, registry)
    old_manifest = load_json_or_none(wiki_general_manifest_path(ws.root, ws.id)) or {}
    return _diff_manifest(fresh, old_manifest)


_LINK_LINE_RE = re.compile(r"^.*\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\).*\n?", re.MULTILINE)


def _strip_link_to(parent_path: Path, target_path: Path) -> None:
    """Removes the one markdown link line in parent_path pointing at target_path, if any."""
    try:
        text = parent_path.read_text(encoding="utf-8")
    except OSError:
        return
    target_resolved = target_path.resolve()

    def _drop_if_matching(match: re.Match[str]) -> str:
        candidate = (parent_path.parent / match.group(1)).resolve()
        return "" if candidate == target_resolved else match.group(0)

    new_text = _LINK_LINE_RE.sub(_drop_if_matching, text)
    if new_text != text:
        parent_path.write_text(new_text, encoding="utf-8")


def _confined_path(wiki_dir: Path, relative: str) -> Path | None:
    """`wiki_dir / relative`, or None if it escapes -- manifest paths are model-written."""
    candidate = (wiki_dir / relative).resolve()
    return candidate if candidate.is_relative_to(wiki_dir.resolve()) else None


def _delete_entry(wiki_dir: Path, entry: dict, parent_path: Path | None) -> None:
    """Removes a deleted component/container's own page and its link from the parent page."""
    path = entry.get("path")
    if not isinstance(path, str):
        return
    page_path = _confined_path(wiki_dir, path)
    if page_path is None:
        return
    if parent_path is not None:
        _strip_link_to(parent_path, page_path)
    page_path.unlink(missing_ok=True)


def apply_update_delta(ws: Workspace, delta: dict) -> dict:
    """Applies every Deleted entry and refreshes files[] for Rewritten/Created; page text is not."""
    wiki_dir = wiki_general_dir(ws.root, ws.id)
    manifest_path = wiki_general_manifest_path(ws.root, ws.id)
    manifest = load_json_or_none(manifest_path) or {"containers": [], "components": []}
    containers = _dict_list(manifest.get("containers"))
    components = _dict_list(manifest.get("components"))

    containers_by_id = {c["id"]: c for c in containers if isinstance(c.get("id"), str)}
    component_delta, container_delta = delta["components"], delta["containers"]

    for component in components:
        if component.get("id") in component_delta["deleted"]:
            parent = containers_by_id.get(component.get("container"))
            parent_page = parent.get("path") if parent is not None else None
            parent_path = (
                _confined_path(wiki_dir, parent_page) if isinstance(parent_page, str) else None
            )
            _delete_entry(wiki_dir, component, parent_path)
    components = [c for c in components if c.get("id") not in component_delta["deleted"]]

    for container in containers:
        if container.get("id") in container_delta["deleted"]:
            _delete_entry(wiki_dir, container, wiki_dir / "index.md")
    containers = [c for c in containers if c.get("id") not in container_delta["deleted"]]

    components_by_id = {c["id"]: c for c in components if isinstance(c.get("id"), str)}
    for entry in component_delta["rewritten"]:
        existing = components_by_id.get(entry["id"])
        if existing is not None:
            existing["files"] = entry["files"]
            existing["container"] = entry["container"]
    for entry in component_delta["created"]:
        components.append({
            "id": entry["id"],
            "name": entry["name"],
            "container": entry["container"],
            "path": f"c3/{entry['id']}.md",
            "files": entry["files"],
        })

    containers_by_id = {c["id"]: c for c in containers if isinstance(c.get("id"), str)}
    for entry in container_delta["rewritten"]:
        existing = containers_by_id.get(entry["id"])
        if existing is not None:
            existing["files"] = entry["files"]
    for entry in container_delta["created"]:
        containers.append({
            "id": entry["id"],
            "name": entry["name"],
            "path": f"c2/{entry['id']}.md",
            "files": entry["files"],
        })

    manifest["containers"] = containers
    manifest["components"] = components
    manifest["edges"] = delta["edges"]
    write_json(manifest_path, manifest)
    return delta


def compute_clustering(ws: Workspace) -> dict:
    """The fixed C2-join grouping (dependencies/clustering.py) Phase A consumes, never invents."""
    graph = ws.engine.snapshot()
    registry = AnalyzerRegistry.with_defaults()
    result = build_clusters(graph, ws.root, registry)
    return {
        "components": [{"id": c.id, "files": c.files} for c in result.components],
        "containers": [{"id": c.id, "component_ids": c.component_ids} for c in result.containers],
        "component_edges": _serialize_edges(result.component_edges),
        "container_edges": _serialize_edges(result.container_edges),
        "undetermined_files": result.undetermined_files,
        "undetermined_candidates": {
            path: undetermined_candidates(path, result, result.file_edge_weights)
            for path in result.undetermined_files
        },
    }
