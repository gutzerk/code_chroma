"""Unit tests for SqliteGraphStore save/load/diff behavior."""

import threading
from datetime import UTC, datetime

from codechroma.graph.models import (
    AISummary,
    AnalysisRun,
    ClassShape,
    HierarchyLevel,
    HierarchyNode,
    MethodShape,
    Repository,
    RunStatus,
    RunTrigger,
    Symbol,
    SymbolKind,
)
from codechroma.graph.store import SqliteGraphStore


def _store(tmp_path):
    return SqliteGraphStore(str(tmp_path / "graph.db"))


def test_corrupt_database_is_preserved_and_recreated(tmp_path):
    db_path = tmp_path / "graph.db"
    db_path.write_bytes(b"not a sqlite database")

    store = _store(tmp_path)
    backups = list(tmp_path.glob("graph.db.corrupt-*"))

    assert len(backups) == 1
    assert (backups[0] / "graph.db").read_bytes() == b"not a sqlite database"
    assert store.load("r1").nodes == {}
    assert store._conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    store._conn.close()


def test_corrupt_database_backup_includes_wal_and_shm(tmp_path):
    store = _store(tmp_path)
    store._conn.close()
    (tmp_path / "graph.db").write_bytes(b"corrupt database")
    (tmp_path / "graph.db-wal").write_bytes(b"corrupt wal")
    (tmp_path / "graph.db-shm").write_bytes(b"corrupt shm")

    backup_dir = store._preserve_corrupt_database()

    assert (backup_dir / "graph.db").read_bytes() == b"corrupt database"
    assert (backup_dir / "graph.db-wal").read_bytes() == b"corrupt wal"
    assert (backup_dir / "graph.db-shm").read_bytes() == b"corrupt shm"


def test_save_and_load_round_trips_nodes_symbols_and_summaries(tmp_path):
    store = _store(tmp_path)
    repo = Repository(id="r1", root_path="/repo", primary_language="python")
    nodes = [
        HierarchyNode(id="n1", name="System", level=HierarchyLevel.SYSTEM, parent_ids=[]),
        HierarchyNode(
            id="n2",
            name="Shared",
            level=HierarchyLevel.COMPONENT,
            parent_ids=["n1", "n1b"],
            depends_on_ids=["n3"],
        ),
        HierarchyNode(id="n3", name="Other", level=HierarchyLevel.COMPONENT, parent_ids=["n1"]),
    ]
    symbols = [
        Symbol(
            id="s1",
            file_path="a.py",
            kind=SymbolKind.FUNCTION,
            name="f",
            qualified_name="f",
            start_line=1,
            end_line=2,
            language="python",
            references=["g"],
            body_statements=[("expression_statement", 1, 1)],
        )
    ]
    summaries = [
        AISummary(
            node_id="n1",
            text="hi",
            generated_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
    ]

    store.save(repo, nodes, symbols, summaries)
    graph = store.load("r1")

    assert set(graph.nodes) == {"n1", "n2", "n3"}
    assert sorted(graph.nodes["n2"].parent_ids) == ["n1", "n1b"]
    assert graph.nodes["n2"].depends_on_ids == ["n3"]
    assert graph.symbols["s1"].references == ["g"]
    assert graph.symbols["s1"].body_statements == [("expression_statement", 1, 1)]
    assert graph.summaries["n1"].text == "hi"


def test_save_and_load_round_trips_class_shapes(tmp_path):
    store = _store(tmp_path)
    repo = Repository(id="r1", root_path="/repo", primary_language="python")
    shape = ClassShape(
        symbol_id="a.py::class::Foo",
        bases=["Base"],
        decorators=["dataclass"],
        is_abstract=True,
        methods={"run": MethodShape(appends_list_attrs=["items"], decorators=["abstractmethod"])},
        class_attrs={"cache": "dict"},
    )

    store.save(repo, [], [], [], class_shapes={"a.py::class::Foo": shape})
    graph = store.load("r1")

    assert graph.class_shapes["a.py::class::Foo"] == shape


def test_save_then_load_is_identical_for_full_graph(tmp_path):
    store = _store(tmp_path)
    repo = Repository(id="r1", root_path="/repo", primary_language="python")
    nodes = [
        HierarchyNode(
            id="n1",
            name="System",
            level=HierarchyLevel.SYSTEM,
            parent_ids=[],
            source_path="root",
        ),
        HierarchyNode(
            id="n2",
            name="Shared",
            level=HierarchyLevel.COMPONENT,
            parent_ids=["n1", "n1_missing"],
            symbol_ids=["s1"],
            depends_on_ids=["n3"],
        ),
        HierarchyNode(id="n3", name="Other", level=HierarchyLevel.COMPONENT, parent_ids=["n1"]),
    ]
    symbols = [
        Symbol(
            id="s1",
            file_path="a.py",
            kind=SymbolKind.FUNCTION,
            name="f",
            qualified_name="pkg.f",
            start_line=1,
            end_line=4,
            language="python",
            references=["g", "h"],
            imports=["os"],
            body_statements=[("expression_statement", 2, 3)],
        )
    ]
    summaries = [AISummary(node_id="n1", text="hi", generated_at=datetime(2026, 1, 1, tzinfo=UTC))]
    shapes = {
        "a.py::class::Foo": ClassShape(
            symbol_id="a.py::class::Foo",
            bases=["Base"],
            decorators=["dataclass"],
            is_abstract=True,
            methods={
                "run": MethodShape(appends_list_attrs=["items"], decorators=["abstractmethod"])
            },
            class_attrs={"cache": "dict"},
        )
    }

    store.save(repo, nodes, symbols, summaries, class_shapes=shapes)
    graph = store.load("r1")

    assert graph.nodes["n1"].source_path == "root"
    assert sorted(graph.nodes["n2"].symbol_ids) == ["s1"]
    assert sorted(graph.nodes["n2"].parent_ids) == ["n1", "n1_missing"]
    assert graph.nodes["n2"].depends_on_ids == ["n3"]
    assert graph.symbols["s1"].references == ["g", "h"]
    assert graph.symbols["s1"].imports == ["os"]
    assert graph.symbols["s1"].body_statements == [("expression_statement", 2, 3)]
    assert graph.summaries["n1"] == summaries[0]
    assert graph.class_shapes["a.py::class::Foo"] == shapes["a.py::class::Foo"]


def test_save_replaces_prior_class_shapes_for_same_repository(tmp_path):
    store = _store(tmp_path)
    repo = Repository(id="r1", root_path="/repo")
    old_shape = ClassShape(symbol_id="a.py::class::Old")
    new_shape = ClassShape(symbol_id="a.py::class::New")

    store.save(repo, [], [], [], class_shapes={"a.py::class::Old": old_shape})
    store.save(repo, [], [], [], class_shapes={"a.py::class::New": new_shape})

    graph = store.load("r1")
    assert set(graph.class_shapes) == {"a.py::class::New"}


def test_save_replaces_prior_graph_for_same_repository(tmp_path):
    store = _store(tmp_path)
    repo = Repository(id="r1", root_path="/repo")
    store.save(repo, [HierarchyNode(id="old", name="Old", level=HierarchyLevel.SYSTEM)], [], [])
    store.save(repo, [HierarchyNode(id="new", name="New", level=HierarchyLevel.SYSTEM)], [], [])

    graph = store.load("r1")
    assert set(graph.nodes) == {"new"}


def test_diff_reports_added_removed_and_reparented(tmp_path):
    store = _store(tmp_path)
    repo = Repository(id="r1", root_path="/repo")

    store.save(
        repo,
        [
            HierarchyNode(id="a", name="A", level=HierarchyLevel.SYSTEM),
            HierarchyNode(id="b", name="B", level=HierarchyLevel.PILLAR, parent_ids=["a"]),
        ],
        [],
        [],
    )
    before = store.load("r1")

    store.save(
        repo,
        [
            HierarchyNode(id="a", name="A", level=HierarchyLevel.SYSTEM),
            HierarchyNode(id="b", name="B", level=HierarchyLevel.PILLAR, parent_ids=["c"]),
            HierarchyNode(id="c", name="C", level=HierarchyLevel.SYSTEM),
        ],
        [],
        [],
    )
    after = store.load("r1")

    diff = store.diff(before, after)
    assert diff.added_node_ids == ["c"]
    assert diff.removed_node_ids == []
    assert diff.reparented_node_ids == [("b", ["a"], ["c"])]


def test_diff_reports_removed_nodes(tmp_path):
    store = _store(tmp_path)
    repo = Repository(id="r1", root_path="/repo")
    store.save(
        repo,
        [
            HierarchyNode(id="a", name="A", level=HierarchyLevel.SYSTEM),
            HierarchyNode(id="b", name="B", level=HierarchyLevel.PILLAR, parent_ids=["a"]),
        ],
        [],
        [],
    )
    before = store.load("r1")
    store.save(repo, [HierarchyNode(id="a", name="A", level=HierarchyLevel.SYSTEM)], [], [])
    after = store.load("r1")

    diff = store.diff(before, after)
    assert diff.removed_node_ids == ["b"]


def test_save_run_inserts_then_updates_status_and_finished_at(tmp_path):
    store = _store(tmp_path)
    run = AnalysisRun(
        id="run1",
        repository_id="r1",
        trigger=RunTrigger.INITIAL,
        status=RunStatus.RUNNING,
        started_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    store.save_run(run)
    row = store._conn.execute(
        "SELECT status, finished_at FROM analysis_runs WHERE id = ?", ("run1",)
    ).fetchone()
    assert row == (RunStatus.RUNNING.value, None)

    run.status = RunStatus.SUCCEEDED
    run.finished_at = datetime(2026, 1, 1, 0, 5, tzinfo=UTC)
    store.save_run(run)

    row = store._conn.execute(
        "SELECT status, finished_at FROM analysis_runs WHERE id = ?", ("run1",)
    ).fetchone()
    assert row == (RunStatus.SUCCEEDED.value, run.finished_at.isoformat())


def test_concurrent_saves_and_loads_never_tear_the_graph(tmp_path):
    """🔴 One connection is shared by request and watcher threads, so the store must serialize."""
    store = _store(tmp_path)
    repo = Repository(id="r1", root_path="/repo", primary_language="python")
    nodes = [
        HierarchyNode(id=f"n{i}", name=f"N{i}", level=HierarchyLevel.COMPONENT, parent_ids=[])
        for i in range(40)
    ]
    failures: list[str] = []

    def hammer() -> None:
        for _ in range(8):
            try:
                store.save(repo, nodes, [], [])
                loaded = len(store.load("r1").nodes)
            except Exception as exc:
                failures.append(f"{type(exc).__name__}: {exc}")
                return
            if loaded != len(nodes):
                failures.append(f"torn read: saw {loaded} of {len(nodes)} nodes")

    threads = [threading.Thread(target=hammer) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert failures == []
