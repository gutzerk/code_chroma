"""GraphEngine: the public API other epics (canvas, editing, live-sync) call directly."""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from collections import Counter, defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

import pathspec

from codechroma.analyzers.registry import AnalyzerRegistry, LanguageAnalyzer
from codechroma.dependencies.digest import build_dependency_digest, write_dependency_digest
from codechroma.graph.builder import GraphBuilder, symbol_origin
from codechroma.graph.models import (
    AISummary,
    AnalysisRun,
    AnalysisRunResult,
    ClassShape,
    Graph,
    HierarchyLevel,
    HierarchyNode,
    Repository,
    RunStatus,
    RunTrigger,
    Symbol,
)
from codechroma.graph.store import GraphStore, SqliteGraphStore
from codechroma.patterns.detector import detect_candidates
from codechroma.skills import is_synced_skill_path
from codechroma.summarize.ai_summarizer import AISummarizer
from codechroma.wiki.generator import generate_wiki
from codechroma.wiki.models import WikiResult, WikiSyncResult
from codechroma.wiki.sync import sync_wiki

logger = logging.getLogger("codechroma.engine")

ROOT_SENTINEL = "__root__"

# Public because change_cards must skip exactly what this walk skips, or card a path with no node.
IGNORED_DIRS = {
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "node_modules",
    ".codechroma",
    "dist",
    "build",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    # IDE/OS clutter -- a bare, uncommitted working tree would otherwise seed change cards.
    ".idea",
    ".vscode",
    ".DS_Store",
    ".editorconfig",
}


def repository_id_for(root_path: str) -> str:
    absolute = str(Path(root_path).resolve())
    return hashlib.sha1(absolute.encode("utf8")).hexdigest()[:16]


def _guess_primary_language(symbols: dict[str, Symbol]) -> str | None:
    counts = Counter(s.language for s in symbols.values())
    if not counts:
        return None
    (language, top_count), *rest = counts.most_common()
    if rest and rest[0][1] == top_count:
        return None
    return language


# No internal "/" means each matches at any depth (research.md #4: 409/500 digest slots were noise).
_BUILTIN_NOISE_PATTERNS = ("vendor/", "worktrees/")


def _rewrite_gitignore_line(line: str, prefix: str) -> str | None:
    """One `.gitignore` line, re-anchored under `prefix` so it matches only within that subtree."""
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    negate = stripped.startswith("!")
    body = stripped[1:] if negate else stripped
    if body.startswith("/"):
        pattern = f"{prefix}{body[1:]}"
    elif "/" in body.rstrip("/"):
        pattern = f"{prefix}{body}"
    else:
        pattern = f"{prefix}**/{body}" if prefix else f"**/{body}"
    return f"!{pattern}" if negate else pattern


def _iter_repo_files(repo_root: Path) -> list[str]:
    # One top-down walk: a nested .gitignore is subtree-scoped -- ancestors known first.
    lines = list(_BUILTIN_NOISE_PATTERNS)
    exclusion_spec = pathspec.PathSpec.from_lines("gitignore", lines)
    relative_paths = []
    excluded_count = 0
    for dirpath, dirnames, filenames in os.walk(repo_root):
        rel_dir = Path(dirpath).relative_to(repo_root)
        if ".gitignore" in filenames:
            prefix = "" if str(rel_dir) == "." else f"{rel_dir.as_posix()}/"
            try:
                raw_text = (Path(dirpath) / ".gitignore").read_text(
                    encoding="utf-8", errors="replace"
                )
            except OSError:
                raw_text = ""
            for raw_line in raw_text.splitlines():
                rewritten = _rewrite_gitignore_line(raw_line, prefix)
                if rewritten is not None:
                    lines.append(rewritten)
            exclusion_spec = pathspec.PathSpec.from_lines("gitignore", lines)
        kept_dirnames = []
        for d in sorted(dirnames):
            if d in IGNORED_DIRS:
                continue
            rel_dir_path = d if str(rel_dir) == "." else (rel_dir / d).as_posix()
            if exclusion_spec.match_file(rel_dir_path + "/"):
                excluded_count += 1
                continue
            kept_dirnames.append(d)
        dirnames[:] = kept_dirnames
        for filename in sorted(filenames):
            relative = (Path(dirpath) / filename).relative_to(repo_root)
            # Only the bridge's own vendored copies, not the user's other .claude/ content.
            if is_synced_skill_path(relative):
                continue
            if exclusion_spec.match_file(relative.as_posix()):
                excluded_count += 1
                continue
            relative_paths.append(relative.as_posix())
    if excluded_count:
        logger.info("repo scan excluded %d noise/.gitignore-matched path(s)", excluded_count)
    return relative_paths


def _write_dependency_digest(repo_root: Path, graph: Graph, repo_id: str) -> None:
    """A digest bug must never fail an otherwise-successful analysis run."""
    try:
        write_dependency_digest(repo_root, build_dependency_digest(graph, repo_root))
    except Exception:
        logger.exception("dependency digest build/write failed for repo %s", repo_id)


def _node_context(node: HierarchyNode, all_symbols: dict[str, Symbol]) -> str:
    parts = [f"level={node.level.value}"]
    if node.source_path:
        parts.append(f"source={node.source_path}")
    symbol = all_symbols.get(node.id)
    if symbol is not None:
        if symbol.references:
            parts.append("calls=" + ", ".join(sorted(set(symbol.references))[:10]))
        if symbol.imports:
            parts.append("imports=" + ", ".join(sorted(set(symbol.imports.values()))[:10]))
    return "; ".join(parts)


class GraphEngine:
    """Parses, groups, summarizes, and persists a repository's semantic architecture graph."""

    def __init__(
        self,
        registry: AnalyzerRegistry | None = None,
        summarizer: AISummarizer | None = None,
        store: GraphStore | None = None,
    ):
        self._registry = registry or AnalyzerRegistry.with_defaults()
        self._summarizer = summarizer or AISummarizer.from_env()
        self._store = store
        self._repository: Repository | None = None
        self._graph = Graph()
        # Lazily-built parent -> children index; keyed by identity since analyze/seed reassign it.
        self._children_index: dict[str, list[HierarchyNode]] | None = None
        self._children_index_graph: Graph | None = None

    def _store_for(self, repo_path: str) -> GraphStore:
        if self._store is not None:
            return self._store
        db_path = str(Path(repo_path) / ".codechroma" / "graph.db")
        self._store = SqliteGraphStore(db_path)
        return self._store

    def _summarize_nodes(
        self,
        nodes: list[HierarchyNode],
        all_symbols: dict[str, Symbol],
        reuse: dict[str, AISummary] | None = None,
        changed_files: set[str] | None = None,
    ) -> dict[str, AISummary]:
        summaries: dict[str, AISummary] = {}
        for node in nodes:
            cached = self._reusable_summary(node, reuse, changed_files)
            if cached is not None:
                summaries[node.id] = cached
                continue
            context = _node_context(node, all_symbols)
            summary = self._summarizer.summarize(node, context)
            summaries[node.id] = summary
        return summaries

    def _reusable_summary(
        self,
        node: HierarchyNode,
        reuse: dict[str, AISummary] | None,
        changed_files: set[str] | None,
    ) -> AISummary | None:
        """Prior summary for a node whose source file didn't change this run, else None."""
        if reuse is None or changed_files is None:
            return None
        if node.source_path is not None and node.source_path in changed_files:
            return None
        return reuse.get(node.id)

    def _parse_file_or_none(
        self, repo_root: Path, file_path: str, analyzer: LanguageAnalyzer
    ) -> tuple[list[Symbol] | None, dict[str, ClassShape] | None]:
        """Parses one file with analyzer; logs and returns (None, None) on any failure."""
        try:
            source = (repo_root / file_path).read_bytes()
            symbols = analyzer.parse(file_path, source)
            # Through the port, never a language ladder: a new analyzer needs no engine edit.
            return symbols, analyzer.class_shapes(file_path, source)
        except Exception:
            logger.exception("failed to parse %s", file_path)
            return None, None

    def _run_analysis(
        self,
        repo_root: Path,
        repo_id: str,
        symbols_by_file: dict[str, list[Symbol] | None],
        trigger: RunTrigger,
        store: GraphStore,
        before: Graph | None = None,
        changed_files: set[str] | None = None,
        class_shapes_by_file: dict[str, dict[str, ClassShape]] | None = None,
    ) -> AnalysisRunResult:
        run = AnalysisRun(
            id=str(uuid.uuid4()),
            repository_id=repo_id,
            trigger=trigger,
            status=RunStatus.RUNNING,
            started_at=datetime.now(UTC),
        )
        store.save_run(run)
        logger.info("analysis run %s running (trigger=%s, repo=%s)", run.id, trigger.value, repo_id)

        try:
            nodes, all_symbols = GraphBuilder().build(
                symbols_by_file, repo_root=repo_root, registry=self._registry
            )
            if not nodes:
                root_name = repo_root.resolve().name or "repository"
                nodes = [
                    HierarchyNode(
                        id="system::__empty__", name=root_name, level=HierarchyLevel.SYSTEM
                    )
                ]

            primary_language = _guess_primary_language(all_symbols)
            repository = Repository(
                id=repo_id, root_path=str(repo_root), primary_language=primary_language
            )
            reuse = before.summaries if (changed_files is not None and before is not None) else None
            summaries = self._summarize_nodes(
                nodes, all_symbols, reuse=reuse, changed_files=changed_files
            )

            if before is None:
                before = store.load(repo_id)
            all_class_shapes: dict[str, ClassShape] = {}
            for file_shapes in (class_shapes_by_file or {}).values():
                all_class_shapes.update(file_shapes)
            after = Graph(
                nodes={n.id: n for n in nodes},
                symbols=all_symbols,
                summaries=summaries,
                class_shapes=all_class_shapes,
            )
            after.pattern_candidates = detect_candidates(after)
            diff = store.diff(before, after)

            store.save(
                repository,
                nodes,
                list(all_symbols.values()),
                list(summaries.values()),
                class_shapes=all_class_shapes,
            )
        except Exception:
            run.status = RunStatus.FAILED
            run.finished_at = datetime.now(UTC)
            store.save_run(run)
            logger.exception("analysis run %s failed", run.id)
            raise

        run.status = RunStatus.SUCCEEDED
        run.finished_at = datetime.now(UTC)
        store.save_run(run)
        logger.info("analysis run %s succeeded (%d nodes)", run.id, len(nodes))

        self._repository = repository
        self._graph = after
        _write_dependency_digest(repo_root, after, repo_id)
        return AnalysisRunResult(status=run.status.value, diff=diff)

    def analyze(self, repo_path: str) -> AnalysisRunResult:
        repo_root = Path(repo_path)
        repo_id = repository_id_for(repo_path)
        store = self._store_for(repo_path)

        symbols_by_file: dict[str, list[Symbol] | None] = {}
        class_shapes_by_file: dict[str, dict[str, ClassShape]] = {}
        for rel_path in _iter_repo_files(repo_root):
            analyzer = self._registry.for_file(rel_path)
            if analyzer is None:
                symbols_by_file[rel_path] = None
                continue
            symbols, class_shapes = self._parse_file_or_none(repo_root, rel_path, analyzer)
            symbols_by_file[rel_path] = symbols
            if class_shapes is not None:
                class_shapes_by_file[rel_path] = class_shapes

        return self._run_analysis(
            repo_root,
            repo_id,
            symbols_by_file,
            RunTrigger.INITIAL,
            store,
            class_shapes_by_file=class_shapes_by_file,
        )

    def reanalyze(self, changed_files: list[str]) -> AnalysisRunResult:
        if self._repository is None:
            raise RuntimeError(
                "reanalyze() requires a prior analyze() call on this engine instance"
            )
        repo_root = Path(self._repository.root_path)
        repo_id = self._repository.id
        store = self._store_for(str(repo_root))

        before = store.load(repo_id)
        symbols_by_previous_file: dict[str, list[Symbol]] = {}
        for symbol in before.symbols.values():
            symbols_by_previous_file.setdefault(symbol.file_path, []).append(symbol)
        class_shapes_by_previous_file: dict[str, dict[str, ClassShape]] = {}
        for symbol_id, shape in before.class_shapes.items():
            file_path = symbol_id.split("::class::", 1)[0]
            class_shapes_by_previous_file.setdefault(file_path, {})[symbol_id] = shape
        previously_known_files = {
            node.source_path
            for node in before.nodes.values()
            if node.level == HierarchyLevel.COMPONENT and node.source_path
        }

        changed_set = {Path(f).as_posix() for f in changed_files}
        symbols_by_file: dict[str, list[Symbol] | None] = {}
        class_shapes_by_file: dict[str, dict[str, ClassShape]] = {}
        for file_path in previously_known_files | changed_set:
            absolute = repo_root / file_path
            if not absolute.exists():
                continue
            if file_path in changed_set:
                analyzer = self._registry.for_file(file_path)
                if analyzer is None:
                    symbols_by_file[file_path] = None
                    continue
                symbols, class_shapes = self._parse_file_or_none(repo_root, file_path, analyzer)
                symbols_by_file[file_path] = symbols
                if class_shapes is not None:
                    class_shapes_by_file[file_path] = class_shapes
            else:
                symbols_by_file[file_path] = symbols_by_previous_file.get(file_path)
                if file_path in class_shapes_by_previous_file:
                    class_shapes_by_file[file_path] = class_shapes_by_previous_file[file_path]

        return self._run_analysis(
            repo_root,
            repo_id,
            symbols_by_file,
            RunTrigger.INCREMENTAL,
            store,
            before=before,
            changed_files=changed_set,
            class_shapes_by_file=class_shapes_by_file,
        )

    def snapshot(self) -> Graph:
        """The current in-memory graph, for another engine to seed itself from."""
        return self._graph

    def seed(self, graph: Graph, repo_path: str) -> bool:
        """Adopts another repository's parsed graph as this one's baseline, then persists it."""
        # Same git history means the same files at the same paths: reanalyze only what diverged.
        if not graph.nodes:
            return False
        repo_root = Path(repo_path)
        repo_id = repository_id_for(repo_path)
        store = self._store_for(repo_path)
        repository = Repository(
            id=repo_id,
            root_path=str(repo_root),
            primary_language=_guess_primary_language(graph.symbols),
        )
        store.save(
            repository,
            list(graph.nodes.values()),
            list(graph.symbols.values()),
            list(graph.summaries.values()),
            class_shapes=graph.class_shapes,
        )
        self._repository = repository
        self._graph = Graph(
            nodes=dict(graph.nodes),
            symbols=dict(graph.symbols),
            summaries=dict(graph.summaries),
            class_shapes=dict(graph.class_shapes),
        )
        self._graph.pattern_candidates = detect_candidates(self._graph)
        _write_dependency_digest(repo_root, self._graph, repo_id)
        return True

    def get_node(self, node_id: str) -> HierarchyNode | None:
        return self._graph.nodes.get(node_id)

    def get_children(self, node_id: str) -> list[HierarchyNode]:
        # O(1) via a parent->children index built once per graph -- shared fix for scanning callers.
        index = self._children_index
        if index is None or self._children_index_graph is not self._graph:
            index = self._children_index = defaultdict(list)
            for node in self._graph.nodes.values():
                for parent_id in node.parent_ids or [ROOT_SENTINEL]:
                    index[parent_id].append(node)
            self._children_index_graph = self._graph
        return index.get(node_id, [])

    def get_summary(self, node_id: str) -> AISummary | None:
        return self._graph.summaries.get(node_id)

    def get_symbol(self, node_id: str) -> Symbol | None:
        return self._graph.symbols.get(node_id)

    def edge_origin(self, from_id: str) -> str | None:
        """`file:line` of an edge's caller -- where a click on the arrow should land."""
        return symbol_origin(self._graph.symbols.get(from_id))

    def iter_symbols(self) -> Iterable[Symbol]:
        """Every symbol in the current graph; the trace mapper indexes these into node ids."""
        return self._graph.symbols.values()

    def get_dependencies(self, node_id: str) -> list[HierarchyNode]:
        node = self._graph.nodes.get(node_id)
        if node is None:
            return []
        return [
            self._graph.nodes[dep_id]
            for dep_id in node.depends_on_ids
            if dep_id in self._graph.nodes
        ]

    def get_dependents(self, node_id: str) -> list[HierarchyNode]:
        return [n for n in self._graph.nodes.values() if node_id in n.depends_on_ids]

    def generate_wiki(self, output_dir: Path | None = None) -> WikiResult:
        """Writes the docstring wiki for the last analyze()'d repo; never runs on its own."""
        repo_root = self.repo_root
        output_dir = output_dir or (repo_root / ".codechroma" / "wiki")
        return generate_wiki(self._graph, repo_root, output_dir)

    @property
    def repo_root(self) -> Path:
        """The last analyze()'d repository's root path; raises if analyze() was never called."""
        if self._repository is None:
            raise RuntimeError(
                "this operation requires a prior analyze() call on this engine instance"
            )
        return Path(self._repository.root_path)

    def sync_wiki(self, output_dir: Path | None = None) -> WikiSyncResult:
        """Regenerates only what changed in the wiki since the last sync; never runs on its own."""
        output_dir = output_dir or (self.repo_root / ".codechroma" / "wiki")
        return sync_wiki(self, output_dir)
