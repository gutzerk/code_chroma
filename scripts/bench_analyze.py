"""Benchmark GraphEngine.analyze() wall-clock time against a ~50k-line repo (spec SC-001).

Usage: poetry run python scripts/bench_analyze.py [path/to/large_sample_repo]

If the target directory doesn't exist (or is empty), a synthetic ~50,000-line polyglot-free
Python fixture is generated there first.
"""

from __future__ import annotations

import shutil
import sys
import time
from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.graph.store import SqliteGraphStore

SC_001_LIMIT_SECONDS = 5 * 60
DIRS = 20
FILES_PER_DIR = 10
CLASSES_PER_FILE = 8
METHODS_PER_CLASS = 5


def _method_source(index: int) -> str:
    return (
        f"    def method_{index}(self, value: int) -> int:\n"
        f"        step = value + {index}\n"
        f"        result = self._helper(step)\n"
        f"        return result\n"
    )


def _class_source(class_index: int) -> str:
    methods = "\n".join(_method_source(i) for i in range(METHODS_PER_CLASS))
    return (
        f"class Worker{class_index}:\n"
        f"    def __init__(self):\n"
        f"        self._state = 0\n\n"
        f"    def _helper(self, value: int) -> int:\n"
        f"        return value * 2\n\n"
        f"{methods}\n"
    )


def _file_source(dir_index: int, file_index: int) -> str:
    base = dir_index * FILES_PER_DIR * CLASSES_PER_FILE + file_index * CLASSES_PER_FILE
    classes = "\n".join(_class_source(base + c) for c in range(CLASSES_PER_FILE))
    return f'"""Synthetic module {dir_index}/{file_index} for benchmarking."""\n\n{classes}'


def generate_large_repo(root: Path) -> int:
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    total_lines = 0
    for d in range(DIRS):
        dir_path = root / f"module_{d}"
        dir_path.mkdir()
        for f in range(FILES_PER_DIR):
            source = _file_source(d, f)
            (dir_path / f"file_{f}.py").write_text(source)
            total_lines += source.count("\n")
    return total_lines


def main() -> None:
    default_target = Path(__file__).parent.parent / "tests" / "fixtures" / "large_sample_repo"
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else default_target

    if not target.exists() or not any(target.iterdir()):
        print(f"Generating synthetic fixture at {target} ...")
        total_lines = generate_large_repo(target)
        print(f"Generated ~{total_lines} lines across {DIRS * FILES_PER_DIR} files.")
    else:
        print(f"Using existing fixture at {target}")

    db_path = target / ".codechroma" / "bench.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    store = SqliteGraphStore(str(db_path))
    engine = GraphEngine(store=store)

    start = time.perf_counter()
    result = engine.analyze(str(target))
    elapsed = time.perf_counter() - start

    print(f"analyze() status: {result.status}")
    print(f"analyze() wall-clock: {elapsed:.2f}s (limit: {SC_001_LIMIT_SECONDS}s)")
    if elapsed <= SC_001_LIMIT_SECONDS:
        print("PASS: within SC-001 budget")
    else:
        print("FAIL: exceeded SC-001 budget")
        sys.exit(1)


if __name__ == "__main__":
    main()
