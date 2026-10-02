"""GraphStore protocol (Repository pattern) and its SQLite v1 implementation."""

from __future__ import annotations

import dataclasses
import functools
import json
import sqlite3
import threading
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from codechroma.graph.models import (
    AISummary,
    AnalysisRun,
    ClassShape,
    Graph,
    GraphDiff,
    HierarchyLevel,
    HierarchyNode,
    MethodShape,
    Repository,
    Symbol,
    SymbolKind,
)


class GraphStore(Protocol):
    """Persists and rehydrates a repository's semantic graph."""

    def save(
        self,
        repository: Repository,
        nodes: list[HierarchyNode],
        symbols: list[Symbol],
        summaries: list[AISummary],
        class_shapes: dict[str, ClassShape] | None = None,
    ) -> None: ...

    def load(self, repository_id: str) -> Graph: ...

    def diff(self, before: Graph, after: Graph) -> GraphDiff: ...

    def save_run(self, run: AnalysisRun) -> None: ...


_SCHEMA = """
CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    root_path TEXT NOT NULL,
    primary_language TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    name TEXT NOT NULL,
    level TEXT NOT NULL,
    source_path TEXT
);

CREATE TABLE IF NOT EXISTS node_parents (
    node_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    PRIMARY KEY (node_id, parent_id)
);

CREATE TABLE IF NOT EXISTS node_symbols (
    node_id TEXT NOT NULL,
    symbol_id TEXT NOT NULL,
    PRIMARY KEY (node_id, symbol_id)
);

CREATE TABLE IF NOT EXISTS node_dependencies (
    node_id TEXT NOT NULL,
    depends_on_id TEXT NOT NULL,
    PRIMARY KEY (node_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS symbols (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    language TEXT NOT NULL,
    parent_symbol_id TEXT,
    references_json TEXT NOT NULL,
    imports_json TEXT NOT NULL,
    body_statements_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
    node_id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    generated_at TEXT
);

CREATE TABLE IF NOT EXISTS class_shapes (
    symbol_id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    bases_json TEXT NOT NULL,
    decorators_json TEXT NOT NULL,
    is_abstract INTEGER NOT NULL,
    methods_json TEXT NOT NULL,
    class_attrs_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

-- Only these three: every other lookup filters on a column already covered by its primary key.
CREATE INDEX IF NOT EXISTS idx_nodes_repository ON nodes (repository_id);
CREATE INDEX IF NOT EXISTS idx_symbols_repository ON symbols (repository_id);
CREATE INDEX IF NOT EXISTS idx_class_shapes_repository ON class_shapes (repository_id);
"""


def _synchronized[T](method: Callable[..., T]) -> Callable[..., T]:
    """Serializes a store method against the others; see `SqliteGraphStore.__init__` for why."""

    @functools.wraps(method)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> T:
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper


class SqliteGraphStore:
    """SQLite-backed GraphStore. One database file per repository being analyzed."""

    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: FastAPI runs sync route handlers on a worker threadpool.
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        # WAL lets readers run during the single writer's delete-then-reinsert commit.
        self._conn.execute("PRAGMA journal_mode=WAL")
        # busy_timeout makes a concurrent writer wait instead of raising "database is locked".
        self._conn.execute("PRAGMA busy_timeout=5000")
        # 🔴 Required by that flag: `save` deletes then reinserts, so a concurrent `load` tears.
        self._lock = threading.RLock()
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    @_synchronized
    def save(
        self,
        repository: Repository,
        nodes: list[HierarchyNode],
        symbols: list[Symbol],
        summaries: list[AISummary],
        class_shapes: dict[str, ClassShape] | None = None,
    ) -> None:
        conn = self._conn
        repo_id = repository.id
        with conn:
            conn.execute(
                "INSERT INTO repositories (id, root_path, primary_language) VALUES (?, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET root_path = excluded.root_path,"
                " primary_language = excluded.primary_language",
                (repo_id, repository.root_path, repository.primary_language),
            )
            conn.execute(
                "DELETE FROM node_parents WHERE node_id IN "
                "(SELECT id FROM nodes WHERE repository_id = ?)",
                (repo_id,),
            )
            conn.execute(
                "DELETE FROM node_symbols WHERE node_id IN "
                "(SELECT id FROM nodes WHERE repository_id = ?)",
                (repo_id,),
            )
            conn.execute(
                "DELETE FROM node_dependencies WHERE node_id IN "
                "(SELECT id FROM nodes WHERE repository_id = ?)",
                (repo_id,),
            )
            conn.execute(
                "DELETE FROM summaries WHERE node_id IN "
                "(SELECT node_id FROM summaries s WHERE EXISTS "
                "(SELECT 1 FROM nodes n WHERE n.id = s.node_id AND n.repository_id = ?))",
                (repo_id,),
            )
            conn.execute("DELETE FROM nodes WHERE repository_id = ?", (repo_id,))
            conn.execute("DELETE FROM symbols WHERE repository_id = ?", (repo_id,))
            conn.execute("DELETE FROM class_shapes WHERE repository_id = ?", (repo_id,))

            conn.executemany(
                "INSERT INTO nodes (id, repository_id, name, level, source_path)"
                " VALUES (?, ?, ?, ?, ?)",
                [
                    (node.id, repo_id, node.name, node.level.value, node.source_path)
                    for node in nodes
                ],
            )
            conn.executemany(
                "INSERT OR IGNORE INTO node_parents (node_id, parent_id) VALUES (?, ?)",
                [
                    (node.id, parent_id)
                    for node in nodes
                    for parent_id in node.parent_ids
                ],
            )
            conn.executemany(
                "INSERT OR IGNORE INTO node_symbols (node_id, symbol_id) VALUES (?, ?)",
                [
                    (node.id, symbol_id)
                    for node in nodes
                    for symbol_id in node.symbol_ids
                ],
            )
            conn.executemany(
                "INSERT OR IGNORE INTO node_dependencies (node_id, depends_on_id) VALUES (?, ?)",
                [
                    (node.id, depends_on_id)
                    for node in nodes
                    for depends_on_id in node.depends_on_ids
                ],
            )
            conn.executemany(
                "INSERT INTO symbols (id, repository_id, file_path, kind, name,"
                " qualified_name, start_line, end_line, language, parent_symbol_id,"
                " references_json, imports_json, body_statements_json)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        symbol.id,
                        repo_id,
                        symbol.file_path,
                        symbol.kind.value,
                        symbol.name,
                        symbol.qualified_name,
                        symbol.start_line,
                        symbol.end_line,
                        symbol.language,
                        symbol.parent_symbol_id,
                        json.dumps(symbol.references),
                        json.dumps(symbol.imports),
                        json.dumps(symbol.body_statements),
                    )
                    for symbol in symbols
                ],
            )
            conn.executemany(
                "INSERT INTO class_shapes (symbol_id, repository_id, bases_json,"
                " decorators_json, is_abstract, methods_json, class_attrs_json)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        shape.symbol_id,
                        repo_id,
                        json.dumps(shape.bases),
                        json.dumps(shape.decorators),
                        int(shape.is_abstract),
                        json.dumps(
                            {name: dataclasses.asdict(m) for name, m in shape.methods.items()}
                        ),
                        json.dumps(shape.class_attrs),
                    )
                    for shape in (class_shapes or {}).values()
                ],
            )

            for summary in summaries:
                conn.execute(
                    "INSERT INTO summaries (node_id, text, generated_at) VALUES (?, ?, ?)"
                    " ON CONFLICT(node_id) DO UPDATE SET text = excluded.text,"
                    " generated_at = excluded.generated_at",
                    (
                        summary.node_id,
                        summary.text,
                        summary.generated_at.isoformat() if summary.generated_at else None,
                    ),
                )

    @_synchronized
    def load(self, repository_id: str) -> Graph:
        conn = self._conn
        graph = Graph()

        node_rows = conn.execute(
            "SELECT id, name, level, source_path FROM nodes WHERE repository_id = ?",
            (repository_id,),
        ).fetchall()
        parents_by_node: dict[str, list[str]] = {}
        for node_id, parent_id in conn.execute(
            "SELECT node_id, parent_id FROM node_parents WHERE node_id IN "
            "(SELECT id FROM nodes WHERE repository_id = ?)",
            (repository_id,),
        ):
            parents_by_node.setdefault(node_id, []).append(parent_id)
        symbols_by_node: dict[str, list[str]] = {}
        for node_id, symbol_id in conn.execute(
            "SELECT node_id, symbol_id FROM node_symbols WHERE node_id IN "
            "(SELECT id FROM nodes WHERE repository_id = ?)",
            (repository_id,),
        ):
            symbols_by_node.setdefault(node_id, []).append(symbol_id)
        depends_on_by_node: dict[str, list[str]] = {}
        for node_id, depends_on_id in conn.execute(
            "SELECT node_id, depends_on_id FROM node_dependencies WHERE node_id IN "
            "(SELECT id FROM nodes WHERE repository_id = ?)",
            (repository_id,),
        ):
            depends_on_by_node.setdefault(node_id, []).append(depends_on_id)

        for node_id, name, level, source_path in node_rows:
            graph.nodes[node_id] = HierarchyNode(
                id=node_id,
                name=name,
                level=HierarchyLevel(level),
                parent_ids=parents_by_node.get(node_id, []),
                source_path=source_path,
                symbol_ids=symbols_by_node.get(node_id, []),
                repository_id=repository_id,
                depends_on_ids=depends_on_by_node.get(node_id, []),
            )

        for row in conn.execute(
            "SELECT id, file_path, kind, name, qualified_name, start_line, end_line,"
            " language, parent_symbol_id, references_json, imports_json,"
            " body_statements_json FROM symbols WHERE repository_id = ?",
            (repository_id,),
        ):
            (
                sym_id,
                file_path,
                kind,
                name,
                qualified_name,
                start_line,
                end_line,
                language,
                parent_symbol_id,
                references_json,
                imports_json,
                body_statements_json,
            ) = row
            graph.symbols[sym_id] = Symbol(
                id=sym_id,
                file_path=file_path,
                kind=SymbolKind(kind),
                name=name,
                qualified_name=qualified_name,
                start_line=start_line,
                end_line=end_line,
                language=language,
                parent_symbol_id=parent_symbol_id,
                references=json.loads(references_json),
                imports=json.loads(imports_json),
                body_statements=[tuple(x) for x in json.loads(body_statements_json)],
            )

        for row in conn.execute(
            "SELECT symbol_id, bases_json, decorators_json, is_abstract, methods_json,"
            " class_attrs_json FROM class_shapes WHERE repository_id = ?",
            (repository_id,),
        ):
            symbol_id, bases_json, decorators_json, is_abstract, methods_json, attrs_json = row
            methods = {
                name: MethodShape(**fields) for name, fields in json.loads(methods_json).items()
            }
            graph.class_shapes[symbol_id] = ClassShape(
                symbol_id=symbol_id,
                bases=json.loads(bases_json),
                decorators=json.loads(decorators_json),
                is_abstract=bool(is_abstract),
                methods=methods,
                class_attrs=json.loads(attrs_json),
            )

        for node_id, text, generated_at in conn.execute(
            "SELECT node_id, text, generated_at FROM summaries"
            " WHERE node_id IN (SELECT id FROM nodes WHERE repository_id = ?)",
            (repository_id,),
        ):
            graph.summaries[node_id] = AISummary(
                node_id=node_id,
                text=text,
                generated_at=datetime.fromisoformat(generated_at) if generated_at else None,
            )

        return graph

    def diff(self, before: Graph, after: Graph) -> GraphDiff:
        before_ids = set(before.nodes)
        after_ids = set(after.nodes)
        added = sorted(after_ids - before_ids)
        removed = sorted(before_ids - after_ids)
        reparented = []
        for node_id in sorted(before_ids & after_ids):
            old_parents = before.nodes[node_id].parent_ids
            new_parents = after.nodes[node_id].parent_ids
            if sorted(old_parents) != sorted(new_parents):
                reparented.append((node_id, list(old_parents), list(new_parents)))
        return GraphDiff(
            added_node_ids=added, removed_node_ids=removed, reparented_node_ids=reparented
        )

    @_synchronized
    def save_run(self, run: AnalysisRun) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO analysis_runs (id, repository_id, trigger, status, started_at,"
                " finished_at) VALUES (?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET status = excluded.status,"
                " finished_at = excluded.finished_at",
                (
                    run.id,
                    run.repository_id,
                    run.trigger.value,
                    run.status.value,
                    run.started_at.isoformat(),
                    run.finished_at.isoformat() if run.finished_at else None,
                ),
            )
