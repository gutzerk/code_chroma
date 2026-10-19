"""Pattern-detector golden export: `python -m tests.pattern_golden` rewrites pattern_golden/.

The C# parity test (`dotnet/CodeChroma.Core.Tests/Patterns`) analyzes the same fixture repo and
must reproduce these candidates and fingerprint, so Python stays the reference implementation.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.patterns.serialize import fingerprint_for, serialize_instance
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN_DIR = FIXTURES / "pattern_golden"
REPOS = ("patterns_repo",)


def export_repo(name: str) -> dict:
    """The heuristic candidates and fingerprint for one fixture repo, in a throwaway copy."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        root = Path(tmp) / "repo"
        shutil.copytree(FIXTURES / name, root)
        engine = GraphEngine(summarizer=AISummarizer())
        engine.analyze(str(root))
        candidates = engine.snapshot().pattern_candidates
        engine.close()
    return {
        "fingerprint": fingerprint_for(candidates),
        "candidates": [serialize_instance(c) for c in candidates],
    }


def main() -> None:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    for name in REPOS:
        text = json.dumps(export_repo(name), indent=2, ensure_ascii=False) + "\n"
        (GOLDEN_DIR / f"{name}.expected.json").write_text(text, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
