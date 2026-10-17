"""Baseline analyze()/reanalyze() timings on the fixture repos (csharp-graph-core, step 0)."""

from __future__ import annotations

import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURES = Path(__file__).parent.parent / "tests" / "fixtures"
REPOS = ("sample_repo", "polyglot_repo", "c0_import_resolution", "wiki_general_clustering")
RUNS = 5


def _peak_rss_mb() -> float | None:
    try:
        import psutil
    except ImportError:
        return None
    if sys.platform != "win32":
        return None
    return psutil.Process().memory_info().peak_wset / 1e6


def _measure(name: str) -> dict:
    analyze, reanalyze = [], []
    for _ in range(RUNS):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            root = Path(tmp) / "repo"
            shutil.copytree(FIXTURES / name, root)
            engine = GraphEngine(summarizer=AISummarizer())
            started = time.perf_counter()
            engine.analyze(str(root))
            analyze.append(time.perf_counter() - started)
            files = (p for p in sorted(root.rglob("*")) if p.is_file())
            changed = next(p for p in files if ".codechroma" not in p.parts)
            rel = changed.relative_to(root).as_posix()
            started = time.perf_counter()
            engine.reanalyze([rel])
            reanalyze.append(time.perf_counter() - started)
    return {
        "repo": name,
        "analyze_ms": statistics.median(analyze) * 1000,
        "reanalyze_ms": statistics.median(reanalyze) * 1000,
    }


def main() -> None:
    for name in REPOS:
        row = _measure(name)
        print(
            f"{row['repo']:28s} analyze {row['analyze_ms']:8.1f} ms   "
            f"reanalyze {row['reanalyze_ms']:8.1f} ms"
        )
    rss = _peak_rss_mb()
    print(f"peak RSS (whole process): {rss:.0f} MB" if rss else "peak RSS: n/a")


if __name__ == "__main__":
    main()
