"""Language-neutral graph-core export: analyzer output in, golden graph/digest/cluster JSON out.

`python -m tests.graph_golden` rewrites `tests/fixtures/graph_golden/`; the C# parity tests
(`dotnet/CodeChroma.Core.Tests`) read the same files, so Python stays the reference implementation.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.context.digest import build_context_digest
from codechroma.context.structure import UnknownRootError, build_structure
from codechroma.dependencies import clustering
from codechroma.dependencies import digest as digest_module
from codechroma.engine import GraphEngine, _iter_repo_files
from codechroma.graph.builder import GraphBuilder
from codechroma.graph.models import Graph, HierarchyNode, Symbol, SymbolKind
from codechroma.graph.store import SqliteGraphStore
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN_DIR = FIXTURES / "graph_golden"
SCHEMA_VERSION = 1
REPOS = (
    "sample_repo",
    "polyglot_repo",
    "c0_import_resolution",
    "wiki_general_clustering",
    "yaml_repo",
    "repo_scan_exclusions",
)
TIGHT_CAPS = {
    "max_callees_per_symbol": 1,
    "max_callers_per_symbol": 1,
    "max_imports_per_file": 1,
    "trivial_max_body_lines": 2,
    "max_detailed_files": 2,
    "max_total_symbol_entries": 6000,
}
STRUCTURE_CASES = {
    "default": {},
    "depth_1": {"depth": 1},
    "depth_5": {"depth": 5},
    "depth_99_is_clamped": {"depth": 99},
    "max_children_1": {"max_children": 1},
    "max_nodes_3": {"depth": 5, "max_nodes": 3},
}
# (edit name, repo, file to touch, text appended or None to delete the file)
SCENARIOS = (
    (
        "append_method",
        "sample_repo",
        "billing/service.py",
        "\n    def cancel_invoice(self, invoice_id: str) -> None:\n"
        "        del self._invoices[invoice_id]\n",
    ),
    ("delete_file", "sample_repo", "web/widget.ts", None),
)


def symbol_to_dict(symbol: Symbol) -> dict:
    data = asdict(symbol)
    data["kind"] = symbol.kind.value
    data["qualified_references"] = [
        {"qualifier": qualifier, "name": name} for qualifier, name in symbol.qualified_references
    ]
    data["body_statements"] = [
        {"type": kind, "start_line": start, "end_line": end}
        for kind, start, end in symbol.body_statements
    ]
    return data


def node_to_dict(node: HierarchyNode) -> dict:
    data = asdict(node)
    data["level"] = node.level.value
    return data


def _parse_repo(root: Path, registry: AnalyzerRegistry) -> dict[str, list[Symbol] | None]:
    """Mirrors GraphEngine.analyze(): no analyzer or a parse failure means a None entry."""
    engine = GraphEngine(registry=registry, summarizer=AISummarizer())
    symbols_by_file: dict[str, list[Symbol] | None] = {}
    for rel_path in _iter_repo_files(root):
        analyzer = registry.for_file(rel_path)
        if analyzer is None:
            symbols_by_file[rel_path] = None
            continue
        symbols_by_file[rel_path] = engine._parse_file_or_none(root, rel_path, analyzer)[0]
    return symbols_by_file


def _import_resolutions(
    symbols_by_file: dict[str, list[Symbol] | None], root: Path, registry: AnalyzerRegistry
) -> dict[str, dict[str, str]]:
    """The analyzer port's resolve_import answers, pre-computed so the core needs no analyzers."""
    resolutions: dict[str, dict[str, str]] = {}
    for file_path, symbols in symbols_by_file.items():
        analyzer = registry.for_file(file_path)
        for symbol in symbols or []:
            if symbol.kind != SymbolKind.MODULE or analyzer is None:
                continue
            for dotted in sorted(set(symbol.imports.values())):
                target = analyzer.resolve_import(dotted, file_path, root)
                if target is not None:
                    resolutions.setdefault(file_path, {})[dotted] = target
    return resolutions


def build_input(root: Path, summaries: dict[str, str]) -> dict:
    """The analyzer-output JSON contract (schema_version 1) the C# core consumes."""
    registry = AnalyzerRegistry.with_defaults()
    symbols_by_file = _parse_repo(root, registry)
    return {
        "schema_version": SCHEMA_VERSION,
        "files": [
            {
                "path": path,
                "symbols": None if symbols is None else [symbol_to_dict(s) for s in symbols],
            }
            for path, symbols in symbols_by_file.items()
        ],
        "import_resolutions": _import_resolutions(symbols_by_file, root, registry),
        "summaries": summaries,
    }


@contextmanager
def _caps(caps: dict[str, int]) -> Iterator[None]:
    """Swaps the digest module's cap getters, the same seam the unit tests monkeypatch."""
    originals = {name: getattr(digest_module, name) for name in caps}
    for name, value in caps.items():
        setattr(digest_module, name, lambda value=value: value)
    try:
        yield
    finally:
        for name, original in originals.items():
            setattr(digest_module, name, original)


def _digest(graph: Graph, root: Path, caps: dict[str, int] | None) -> dict:
    if caps is None:
        built = digest_module.build_dependency_digest(graph, root)
    else:
        with _caps(caps):
            built = digest_module.build_dependency_digest(graph, root)
    built.pop("generated_at")
    return built


def _clusters(graph: Graph, root: Path) -> dict:
    registry = AnalyzerRegistry.with_defaults()
    result = clustering.build_clusters(graph, root, registry)
    weights = clustering.file_edge_weights(graph)
    return {
        "components": [asdict(c) for c in result.components],
        "containers": [asdict(c) for c in result.containers],
        "component_edges": [asdict(e) for e in result.component_edges],
        "container_edges": [asdict(e) for e in result.container_edges],
        "undetermined_files": result.undetermined_files,
        "file_edge_weights": [[a, b, w] for (a, b), w in sorted(weights.items())],
        "undetermined_candidates": {
            f: clustering.undetermined_candidates(f, result, weights)
            for f in result.undetermined_files
        },
    }


def _structure(engine: GraphEngine) -> dict:
    systems = sorted(n.id for n in engine.get_children("__root__"))
    cases = dict(STRUCTURE_CASES)
    if systems:
        cases["root_first_system_depth_1"] = {"root_id": systems[0], "depth": 1}
    cases["unknown_root"] = {"root_id": "dir::does-not-exist"}
    out = {}
    for name, args in cases.items():
        try:
            out[name] = {"args": args, "result": build_structure(engine, **args)}
        except UnknownRootError:
            out[name] = {"args": args, "error": "unknown_root"}
    return out


def _context_digest(engine: GraphEngine, root: Path) -> dict:
    """repo_name is the throwaway copy's directory name, so it is left out of the golden."""
    built = build_context_digest(engine, root)
    built.pop("repo_name")
    return built


def _engine_for(root: Path) -> GraphEngine:
    store = SqliteGraphStore(str(root.parent / "g.db"))
    engine = GraphEngine(summarizer=AISummarizer(), store=store)
    engine.analyze(str(root))
    return engine


def _copy_fixture(name: str, tmp: Path) -> Path:
    root = tmp / "repo"
    shutil.copytree(FIXTURES / name, root)
    return root


def export_repo(name: str) -> tuple[dict, dict]:
    """(input, expected) for one fixture repo, analyzed in a throwaway copy."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        root = _copy_fixture(name, Path(tmp))
        engine = _engine_for(root)
        graph = engine.snapshot()
        summaries = {nid: s.text for nid, s in graph.summaries.items()}
        analysis_input = build_input(root, summaries)
        expected = {
            "schema_version": SCHEMA_VERSION,
            "nodes": [node_to_dict(n) for n in graph.nodes.values()],
            "digest": _digest(graph, root, None),
            "digest_tight": _digest(graph, root, TIGHT_CAPS),
            "clusters": _clusters(graph, root),
            "structure": _structure(engine),
            "context_digest": _context_digest(engine, root),
        }
        engine.close()
    return analysis_input, expected


def export_scenario(repo: str, rel_path: str, appended: str | None) -> dict:
    """Input after one edit plus the GraphDiff GraphEngine.reanalyze() reports for it."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        root = _copy_fixture(repo, Path(tmp))
        engine = _engine_for(root)
        before_input = build_input(root, {})
        target = root / rel_path
        if appended is None:
            target.unlink()
        else:
            target.write_text(target.read_text(encoding="utf-8") + appended, encoding="utf-8")
        diff = engine.reanalyze([rel_path]).diff
        after_input = build_input(root, {})
        engine.close()
    return {
        "schema_version": SCHEMA_VERSION,
        "before": before_input,
        "after": after_input,
        "diff": {
            "added_node_ids": diff.added_node_ids,
            "removed_node_ids": diff.removed_node_ids,
            "reparented_node_ids": [[n, list(o), list(p)] for n, o, p in diff.reparented_node_ids],
        },
    }


def builder_nodes(input_json: dict) -> list[dict]:
    """Rebuilds nodes straight from a contract input, for the Python-side regeneration check."""
    symbols = {
        f["path"]: None
        if f["symbols"] is None
        else [
            Symbol(
                **{
                    **s,
                    "kind": SymbolKind(s["kind"]),
                    "qualified_references": [
                        (p["qualifier"], p["name"]) for p in s["qualified_references"]
                    ],
                    "body_statements": [
                        (b["type"], b["start_line"], b["end_line"]) for b in s["body_statements"]
                    ],
                }
            )
            for s in f["symbols"]
        ]
        for f in input_json["files"]
    }
    nodes, _ = GraphBuilder().build(symbols)
    return [node_to_dict(n) for n in nodes]


def _dump(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, indent=1, sort_keys=False, ensure_ascii=False)
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def all_goldens() -> dict[str, dict]:
    """Every golden file name -> content; the single source both the CLI and the test use."""
    goldens: dict[str, dict] = {}
    for name in REPOS:
        analysis_input, expected = export_repo(name)
        goldens[f"{name}.input.json"] = analysis_input
        goldens[f"{name}.expected.json"] = expected
    for edit, repo, rel_path, appended in SCENARIOS:
        goldens[f"{repo}.reanalyze-{edit}.json"] = export_scenario(repo, rel_path, appended)
    return goldens


def main() -> None:
    for filename, data in all_goldens().items():
        _dump(GOLDEN_DIR / filename, data)
        print("wrote", filename)


if __name__ == "__main__":
    main()
