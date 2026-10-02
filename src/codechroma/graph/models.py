"""Core data model for the semantic architecture graph engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum


class HierarchyLevel(StrEnum):
    SYSTEM = "system"
    PILLAR = "pillar"
    COMPONENT = "component"
    SERVICE = "service"
    FUNCTION = "function"
    LOGIC_BLOCK = "logic_block"
    CODE = "code"


# The levels backed by a real path on disk — deeper levels are symbols, which no path can name.
DIRECTORY_LEVELS = (HierarchyLevel.SYSTEM, HierarchyLevel.PILLAR)
FILESYSTEM_LEVELS = (*DIRECTORY_LEVELS, HierarchyLevel.COMPONENT)


class SymbolKind(StrEnum):
    MODULE = "module"
    CLASS = "class"
    FUNCTION = "function"
    VARIABLE = "variable"


class RunTrigger(StrEnum):
    INITIAL = "initial"
    INCREMENTAL = "incremental"


class RunStatus(StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(slots=True)
class Repository:
    id: str
    root_path: str
    primary_language: str | None = None


class PatternType(StrEnum):
    STRATEGY = "strategy"
    FACADE = "facade"
    ADAPTER = "adapter"
    REGISTRY = "registry"
    SINGLETON = "singleton"
    OBSERVER = "observer"
    REPOSITORY = "repository"


class PatternRole(StrEnum):
    INTERFACE = "interface"
    IMPLEMENTATION = "implementation"
    DISPATCHER = "dispatcher"
    FACADE = "facade"
    TARGET = "target"
    ADAPTER = "adapter"
    ADAPTEE = "adaptee"
    REGISTRY = "registry"
    ENTRY = "entry"
    INSTANCE = "instance"
    SUBJECT = "subject"
    OBSERVER = "observer"


class PatternRelationKind(StrEnum):
    IMPLEMENTS = "implements"
    USES = "uses"
    WRAPS = "wraps"
    REGISTERS = "registers"


@dataclass(slots=True)
class Symbol:
    """A parsed unit of code (module/class/function/variable)."""

    id: str
    file_path: str
    kind: SymbolKind
    name: str
    qualified_name: str
    start_line: int
    end_line: int
    language: str
    parent_symbol_id: str | None = None
    # Raw (unresolved) names this symbol's body calls or references.
    references: list[str] = field(default_factory=list)
    # Python/Go/TS only: (qualifier, name) pairs for calls like `m.z()`; sibling to references.
    qualified_references: list[tuple[str, str]] = field(default_factory=list)
    # Go FUNCTION only: local assignment targets for `_detect_singleton_go`; not a call edge source.
    assigned_identifiers: list[str] = field(default_factory=list)
    # Only populated on a MODULE symbol: local imported name -> dotted source module path.
    imports: dict[str, str] = field(default_factory=dict)
    # FUNCTION only: (statement_type, start_line, end_line) per direct body statement, in order.
    body_statements: list[tuple[str, int, int]] = field(default_factory=list)
    # Leading docstring/doc-comment text, cleandoc'd; None if the symbol has none.
    docstring: str | None = None
    # Go/TS only: exported at parse time -- Go via capitalized name, TS via an `export` wrapper.
    is_exported: bool = False


@dataclass(slots=True)
class HierarchyNode:
    id: str
    name: str
    level: HierarchyLevel
    parent_ids: list[str] = field(default_factory=list)
    source_path: str | None = None
    symbol_ids: list[str] = field(default_factory=list)
    repository_id: str | None = None
    depends_on_ids: list[str] = field(default_factory=list)
    # Folder nodes only: True iff every file in its whole subtree is a doc file; always recomputed.
    doc_only: bool = False


def filesystem_order(node: HierarchyNode) -> tuple[bool, str]:
    """Folders first, then files, each alphabetical — one ordering every path listing shares."""
    return (node.level == HierarchyLevel.COMPONENT, node.name)


@dataclass(slots=True)
class AISummary:
    node_id: str
    text: str
    generated_at: datetime | None = None


@dataclass(slots=True)
class MethodShape:
    decorators: list[str] = field(default_factory=list)
    writes_dict_attrs: list[str] = field(default_factory=list)  # self.X[k] = v
    reads_dict_attrs: list[str] = field(default_factory=list)  # self.X[k] / self.X.get(k)
    appends_list_attrs: list[str] = field(default_factory=list)  # self.X.append(v)
    iterates_attrs: list[str] = field(default_factory=list)  # for x in self.X
    sets_class_attr: list[str] = field(default_factory=list)  # cls.X = ... (Singleton)
    checks_none_class_attr: list[str] = field(default_factory=list)  # cls.X is None
    calls_on_attr: dict[str, list[str]] = field(default_factory=dict)  # self.X.method()


@dataclass(slots=True)
class ClassShape:
    symbol_id: str
    bases: list[str] = field(default_factory=list)
    decorators: list[str] = field(default_factory=list)
    is_abstract: bool = False
    methods: dict[str, MethodShape] = field(default_factory=dict)
    class_attrs: dict[str, str] = field(default_factory=dict)  # name -> dict/list/none/other
    kind: str = "class"  # "class" (Python) | "struct" | "interface" (Go)


@dataclass(slots=True)
class PatternParticipant:
    id: str
    role: PatternRole
    name: str
    qualified_name: str
    node_id: str | None = None
    path: str | None = None
    # None from the heuristic; set only via the codechroma-patterns skill's authored overlay.
    description: str | None = None


@dataclass(slots=True)
class PatternRelation:
    # from_id/to_id, not from/to (reserved keyword) -- resolver serializes these back to from/to.
    from_id: str
    to_id: str
    kind: PatternRelationKind
    label: str | None = None


@dataclass(slots=True)
class PatternInstance:
    id: str
    type: PatternType
    name: str
    description: str | None = None
    confirmed: bool | None = None  # None = heuristic-only, no API key / not yet confirmed
    confidence: float | None = None
    participants: list[PatternParticipant] = field(default_factory=list)
    relations: list[PatternRelation] = field(default_factory=list)


@dataclass(slots=True)
class AnalysisRun:
    id: str
    repository_id: str
    trigger: RunTrigger
    status: RunStatus
    started_at: datetime
    finished_at: datetime | None = None


@dataclass(slots=True)
class GraphDiff:
    added_node_ids: list[str] = field(default_factory=list)
    removed_node_ids: list[str] = field(default_factory=list)
    # (node_id, old_parent_ids, new_parent_ids)
    reparented_node_ids: list[tuple[str, list[str], list[str]]] = field(default_factory=list)


@dataclass(slots=True)
class AnalysisRunResult:
    status: str
    diff: GraphDiff


@dataclass(slots=True)
class Graph:
    """In-memory rehydrated view of a repository's persisted graph."""

    nodes: dict[str, HierarchyNode] = field(default_factory=dict)
    symbols: dict[str, Symbol] = field(default_factory=dict)
    summaries: dict[str, AISummary] = field(default_factory=dict)
    class_shapes: dict[str, ClassShape] = field(default_factory=dict)
    pattern_candidates: list[PatternInstance] = field(default_factory=list)
