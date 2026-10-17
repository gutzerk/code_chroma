"""Analyzer-output export for the C# graph core: symbols, import resolutions and summaries.

`python -m codechroma.analysis_export <root>` prints the schema_version 1 analysis input;
`python -m codechroma.analysis_export <root> --files a.py b.py` prints a delta for those files.
Nothing is written to the repo and the summarizer is always the offline one.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.engine import GraphEngine, _iter_repo_files, _node_context
from codechroma.graph.builder import GraphBuilder
from codechroma.graph.models import Symbol, SymbolKind
from codechroma.summarize.ai_summarizer import AISummarizer

SCHEMA_VERSION = 1


def symbol_to_dict(symbol: Symbol) -> dict:
    """One symbol in the analyzer-output contract's snake_case shape."""
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


def parse_files(
    root: Path, paths: list[str], registry: AnalyzerRegistry
) -> dict[str, list[Symbol] | None]:
    """Mirrors GraphEngine.analyze(): no analyzer or a parse failure means a None entry."""
    engine = GraphEngine(registry=registry, summarizer=AISummarizer())
    symbols_by_file: dict[str, list[Symbol] | None] = {}
    for rel_path in paths:
        analyzer = registry.for_file(rel_path)
        if analyzer is None:
            symbols_by_file[rel_path] = None
            continue
        symbols_by_file[rel_path] = engine._parse_file_or_none(root, rel_path, analyzer)[0]
    return symbols_by_file


def import_resolutions(
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


def offline_summaries(
    symbols_by_file: dict[str, list[Symbol] | None], root: Path, registry: AnalyzerRegistry
) -> dict[str, str]:
    """Node id -> offline summary text, built exactly as the engine's summarize step does."""
    nodes, all_symbols = GraphBuilder().build(symbols_by_file, repo_root=root, registry=registry)
    summarizer = AISummarizer()
    return {
        node.id: summarizer.summarize(node, _node_context(node, all_symbols)).text for node in nodes
    }


def build_input(root: Path, summaries: dict[str, str] | None = None) -> dict:
    """The full analysis input; summaries are computed offline when not supplied."""
    registry = AnalyzerRegistry.with_defaults()
    symbols_by_file = parse_files(root, _iter_repo_files(root), registry)
    return {
        "schema_version": SCHEMA_VERSION,
        "files": [
            {
                "path": path,
                "symbols": None if symbols is None else [symbol_to_dict(s) for s in symbols],
            }
            for path, symbols in symbols_by_file.items()
        ],
        "import_resolutions": import_resolutions(symbols_by_file, root, registry),
        "summaries": offline_summaries(symbols_by_file, root, registry)
        if summaries is None
        else summaries,
    }


def build_delta(root: Path, changed: list[str]) -> dict:
    """Changed files re-parsed, vanished files listed as removed, plus their import resolutions."""
    registry = AnalyzerRegistry.with_defaults()
    present = [Path(f).as_posix() for f in changed if (root / f).exists()]
    removed = [Path(f).as_posix() for f in changed if not (root / f).exists()]
    symbols_by_file = parse_files(root, present, registry)
    return {
        "changed": [
            {
                "path": path,
                "symbols": None if symbols is None else [symbol_to_dict(s) for s in symbols],
            }
            for path, symbols in symbols_by_file.items()
        ],
        "removed": removed,
        "import_resolutions": import_resolutions(symbols_by_file, root, registry),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export analyzer output for the C# graph core")
    parser.add_argument("root", type=Path)
    parser.add_argument("--files", nargs="*", default=None, help="export a delta for these files")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    payload = build_input(root) if args.files is None else build_delta(root, args.files)
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump(payload, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
