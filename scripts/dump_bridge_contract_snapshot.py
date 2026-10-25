# ruff: noqa: E501
"""Regenerates tests/fixtures/bridge_contract/engine_snapshot.sample_repo.json from the Python engine.

The C# bridge talks to graph data through an `IGraphEngine`; until CodeChroma.Core exists, its test
engine loads this snapshot, so the graph routes can be replayed against both backends.

Usage: poetry run python scripts/dump_bridge_contract_snapshot.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from codechroma.engine import GraphEngine

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "tests" / "fixtures" / "sample_repo"
OUT = ROOT / "tests" / "fixtures" / "bridge_contract" / "engine_snapshot.sample_repo.json"


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp) / "repo"
        shutil.copytree(SAMPLE, repo)
        subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
        engine = GraphEngine()
        engine.analyze(str(repo))
        graph = engine.snapshot()
        snapshot = {
            "repo": "sample_repo",
            "nodes": [
                {
                    "id": node.id,
                    "name": node.name,
                    "level": node.level.value,
                    "parent_ids": node.parent_ids,
                    "source_path": node.source_path,
                    "doc_only": node.doc_only,
                    "depends_on_ids": node.depends_on_ids,
                }
                for node in graph.nodes.values()
            ],
            "symbols": [
                {
                    "id": symbol.id,
                    "file_path": symbol.file_path,
                    "start_line": symbol.start_line,
                    "end_line": symbol.end_line,
                    "language": symbol.language,
                    "kind": symbol.kind.value,
                    "name": symbol.name,
                    "parent_symbol_id": symbol.parent_symbol_id,
                    "imports": symbol.imports,
                }
                for symbol in graph.symbols.values()
            ],
            "summaries": {nid: summary.text for nid, summary in graph.summaries.items()},
        }
        engine.close()
    OUT.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(snapshot['nodes'])} nodes, {len(snapshot['symbols'])} symbols)")


if __name__ == "__main__":
    main()
