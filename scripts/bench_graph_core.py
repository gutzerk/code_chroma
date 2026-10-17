"""Baseline analyze()/reanalyze() timings on the fixture repos (csharp-graph-core, step 0)."""

from __future__ import annotations

import json
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


def _time_stages(repo: Path, dump_input: Path | None) -> None:
    """Times only builder, digest and clustering on an already-parsed repo (the ported slice)."""
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from tests.graph_golden import _parse_repo, build_input

    from codechroma.analyzers.registry import AnalyzerRegistry
    from codechroma.dependencies.clustering import build_clusters
    from codechroma.dependencies.digest import build_dependency_digest
    from codechroma.graph.builder import GraphBuilder
    from codechroma.graph.models import Graph

    registry = AnalyzerRegistry.with_defaults()
    parsed = _parse_repo(repo, registry)
    if dump_input is not None:
        dump_input.write_text(json.dumps(build_input(repo, {})), encoding="utf-8")
    for run in range(RUNS):
        started = time.perf_counter()
        nodes, symbols = GraphBuilder().build(parsed, repo_root=repo, registry=registry)
        built = time.perf_counter()
        graph = Graph(nodes={n.id: n for n in nodes}, symbols=symbols)
        build_dependency_digest(graph, repo)
        digested = time.perf_counter()
        build_clusters(graph, repo, registry)
        done = time.perf_counter()
        print(
            f"run {run}: build {1000 * (built - started):7.1f} ms  "
            f"digest {1000 * (digested - built):7.1f} ms  "
            f"clusters {1000 * (done - digested):7.1f} ms"
        )


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--stages":
        dump = Path(sys.argv[3]) if len(sys.argv) > 3 else None
        _time_stages(Path(sys.argv[2]), dump)
        return
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
