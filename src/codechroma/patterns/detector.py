"""Free, synchronous heuristic pass over ClassShapes -- finds pattern-shaped candidates.

Every candidate is emitted with confirmed=None (never True/False -- only the codechroma-patterns
skill, via bridge/content_generators.py's SkillAgent runner, sets those); confidence is a rough
heuristic score, not a probability.
Recomputed on every analyze()/reanalyze(), so it must stay pure and cheap.
"""

from __future__ import annotations

from dataclasses import dataclass

from codechroma.graph.models import (
    ClassShape,
    Graph,
    PatternInstance,
    PatternParticipant,
    PatternRelation,
    PatternRelationKind,
    PatternRole,
    PatternType,
    Symbol,
    SymbolKind,
)

_REPOSITORY_SUFFIXES = ("repository", "repo")


@dataclass(frozen=True, slots=True)
class _Index:
    """Every derived view the detectors share, built once per detect_candidates() call."""

    graph: Graph
    # Sorted, not raw: detectors emit in id order, so the ordering is contract rather than cost.
    sorted_symbols: list[tuple[str, Symbol]]
    sorted_shapes: list[tuple[str, ClassShape]]
    class_id_by_name: dict[str, str]
    references_by_id: dict[str, set[str]]


def _build_index(graph: Graph) -> _Index:
    sorted_symbols = sorted(graph.symbols.items())
    class_id_by_name: dict[str, str] = {}
    for symbol_id, symbol in sorted_symbols:
        if symbol.kind == SymbolKind.CLASS and symbol.name not in class_id_by_name:
            class_id_by_name[symbol.name] = symbol_id
    return _Index(
        graph=graph,
        sorted_symbols=sorted_symbols,
        sorted_shapes=sorted(graph.class_shapes.items()),
        class_id_by_name=class_id_by_name,
        references_by_id={
            symbol_id: set(symbol.references) for symbol_id, symbol in sorted_symbols
        },
    )


def _structural_interface_matches(index: _Index) -> dict[str, list[str]]:
    """Go has no `implements` keyword -- match a struct to an interface by method-name superset."""
    matches: dict[str, list[str]] = {}
    interfaces = [
        (symbol_id, shape) for symbol_id, shape in index.sorted_shapes if shape.kind == "interface"
    ]
    for interface_id, interface_shape in interfaces:
        method_names = set(interface_shape.methods)
        if not method_names:
            continue
        interface_name = index.graph.symbols[interface_id].name
        for symbol_id, shape in index.sorted_shapes:
            if symbol_id == interface_id or shape.kind == "interface":
                continue
            if method_names <= set(shape.methods):
                matches.setdefault(interface_name, []).append(symbol_id)
    return matches


def _implementations_by_base(index: _Index) -> dict[str, list[str]]:
    by_base: dict[str, list[str]] = {}
    for symbol_id, shape in index.graph.class_shapes.items():
        for base in shape.bases:
            by_base.setdefault(base, []).append(symbol_id)
    for base_name, impl_ids in _structural_interface_matches(index).items():
        existing = by_base.setdefault(base_name, [])
        for impl_id in impl_ids:
            if impl_id not in existing:
                existing.append(impl_id)
    return by_base


def _participant(graph: Graph, symbol_id: str, role: PatternRole) -> PatternParticipant:
    symbol = graph.symbols.get(symbol_id)
    if symbol is None:
        return PatternParticipant(id=symbol_id, role=role, name=symbol_id, qualified_name=symbol_id)
    node_id = symbol_id if symbol_id in graph.nodes else None
    return PatternParticipant(
        id=symbol_id,
        role=role,
        name=symbol.name,
        qualified_name=symbol.qualified_name,
        node_id=node_id,
        path=symbol.file_path,
    )


def _free_participant(owner_id: str, attr_name: str, role: PatternRole) -> PatternParticipant:
    """A referenced-only participant; id scoped by owner so same-named attrs don't collide."""
    return PatternParticipant(
        id=f"attr::{owner_id}::{attr_name}", role=role, name=attr_name, qualified_name=attr_name
    )


def _find_dispatcher(index: _Index, excluded: set[str], method_names: set[str]) -> str | None:
    for symbol_id, symbol in index.sorted_symbols:
        if symbol_id in excluded or symbol.kind != SymbolKind.CLASS:
            continue
        if method_names & index.references_by_id[symbol_id]:
            return symbol_id
    return None


def _interface_impl_group(
    graph: Graph, interface_id: str, impl_ids: list[str]
) -> tuple[list[PatternParticipant], list[PatternRelation]]:
    """One interface plus its sorted implementations, and the IMPLEMENTS edge from each to it."""
    sorted_impls = sorted(impl_ids)
    participants = [_participant(graph, interface_id, PatternRole.INTERFACE)]
    participants += [
        _participant(graph, impl_id, PatternRole.IMPLEMENTATION) for impl_id in sorted_impls
    ]
    relations = [
        PatternRelation(from_id=impl_id, to_id=interface_id, kind=PatternRelationKind.IMPLEMENTS)
        for impl_id in sorted_impls
    ]
    return participants, relations


def _detect_strategy(index: _Index) -> list[PatternInstance]:
    graph = index.graph
    instances: list[PatternInstance] = []
    for base_name, impl_ids in sorted(_implementations_by_base(index).items()):
        if len(impl_ids) < 2:
            continue
        base_id = index.class_id_by_name.get(base_name)
        base_shape = graph.class_shapes.get(base_id) if base_id else None
        if base_id is None or base_shape is None or not base_shape.is_abstract:
            continue
        method_names = set(base_shape.methods)
        if not method_names:
            continue
        participants, relations = _interface_impl_group(graph, base_id, impl_ids)
        dispatcher_id = _find_dispatcher(index, {base_id, *impl_ids}, method_names)
        if dispatcher_id is not None:
            participants.append(_participant(graph, dispatcher_id, PatternRole.DISPATCHER))
            relations.append(
                PatternRelation(from_id=dispatcher_id, to_id=base_id, kind=PatternRelationKind.USES)
            )
        instances.append(
            PatternInstance(
                id=f"strategy::{base_id}",
                type=PatternType.STRATEGY,
                name=f"Strategy — {graph.symbols[base_id].name} dispatch",
                confidence=0.6,
                participants=participants,
                relations=relations,
            )
        )
    return instances


def _aggregated_calls_on_attr(shape: ClassShape) -> set[str]:
    """Every attr name any of this shape's methods calls through, pooled across all methods."""
    return {attr for method in shape.methods.values() for attr in method.calls_on_attr}


def _detect_facade(index: _Index) -> list[PatternInstance]:
    graph = index.graph
    instances: list[PatternInstance] = []
    for symbol_id, shape in index.sorted_shapes:
        aggregated_attrs = _aggregated_calls_on_attr(shape)
        if not shape.methods or len(shape.methods) > 6 or len(aggregated_attrs) < 3:
            continue
        participants = [_participant(graph, symbol_id, PatternRole.FACADE)]
        relations = []
        for attr in sorted(aggregated_attrs):
            target = _free_participant(symbol_id, attr, PatternRole.TARGET)
            participants.append(target)
            relations.append(
                PatternRelation(from_id=symbol_id, to_id=target.id, kind=PatternRelationKind.WRAPS)
            )
        instances.append(
            PatternInstance(
                id=f"facade::{symbol_id}",
                type=PatternType.FACADE,
                name=f"Facade — {graph.symbols[symbol_id].name}",
                confidence=0.35,
                participants=participants,
                relations=relations,
            )
        )
    return instances


def _detect_adapter(index: _Index) -> list[PatternInstance]:
    graph = index.graph
    instances: list[PatternInstance] = []
    for symbol_id, shape in index.sorted_shapes:
        if "adapter" not in graph.symbols[symbol_id].name.lower():
            continue
        aggregated_attrs = _aggregated_calls_on_attr(shape)
        if len(aggregated_attrs) != 1:
            continue
        participants = [_participant(graph, symbol_id, PatternRole.ADAPTER)]
        relations = []
        for base in shape.bases:
            base_id = index.class_id_by_name.get(base)
            if base_id is not None:
                participants.append(_participant(graph, base_id, PatternRole.TARGET))
                relations.append(
                    PatternRelation(
                        from_id=symbol_id, to_id=base_id, kind=PatternRelationKind.IMPLEMENTS
                    )
                )
        adaptee = _free_participant(symbol_id, next(iter(aggregated_attrs)), PatternRole.ADAPTEE)
        participants.append(adaptee)
        relations.append(
            PatternRelation(from_id=symbol_id, to_id=adaptee.id, kind=PatternRelationKind.WRAPS)
        )
        instances.append(
            PatternInstance(
                id=f"adapter::{symbol_id}",
                type=PatternType.ADAPTER,
                name=f"Adapter — {graph.symbols[symbol_id].name}",
                confidence=0.55,
                participants=participants,
                relations=relations,
            )
        )
    return instances


def _detect_registry(index: _Index) -> list[PatternInstance]:
    graph = index.graph
    instances: list[PatternInstance] = []
    for symbol_id, shape in index.sorted_shapes:
        registry_attrs = {
            name for name, kind in shape.class_attrs.items() if kind in ("dict", "map")
        }
        writers = {attr for method in shape.methods.values() for attr in method.writes_dict_attrs}
        if not (registry_attrs & writers):
            continue
        participants = [_participant(graph, symbol_id, PatternRole.REGISTRY)]
        relations = []
        method_names = set(shape.methods)
        for other_id, other_symbol in index.sorted_symbols:
            if other_id == symbol_id or other_symbol.kind != SymbolKind.CLASS:
                continue
            if method_names & index.references_by_id[other_id]:
                participants.append(_participant(graph, other_id, PatternRole.ENTRY))
                relations.append(
                    PatternRelation(
                        from_id=other_id, to_id=symbol_id, kind=PatternRelationKind.REGISTERS
                    )
                )
        instances.append(
            PatternInstance(
                id=f"registry::{symbol_id}",
                type=PatternType.REGISTRY,
                name=f"Registry — {graph.symbols[symbol_id].name}",
                confidence=0.6,
                participants=participants,
                relations=relations,
            )
        )
    return instances


def _detect_singleton(index: _Index) -> list[PatternInstance]:
    graph = index.graph
    instances: list[PatternInstance] = []
    for symbol_id, shape in index.sorted_shapes:
        checked = {
            attr for method in shape.methods.values() for attr in method.checks_none_class_attr
        }
        set_attrs = {attr for method in shape.methods.values() for attr in method.sets_class_attr}
        if not (checked & set_attrs):
            continue
        instances.append(
            PatternInstance(
                id=f"singleton::{symbol_id}",
                type=PatternType.SINGLETON,
                name=f"Singleton — {graph.symbols[symbol_id].name}",
                confidence=0.7,
                participants=[_participant(graph, symbol_id, PatternRole.INSTANCE)],
                relations=[],
            )
        )
    return instances


def _detect_singleton_go(index: _Index) -> list[PatternInstance]:
    """Go's package-var-plus-sync.Once idiom -- has no class, so this reads Symbols directly."""
    graph = index.graph
    instances: list[PatternInstance] = []
    for symbol_id, symbol in index.sorted_symbols:
        if symbol.kind != SymbolKind.VARIABLE:
            continue
        module = graph.symbols.get(symbol.parent_symbol_id or "")
        if module is None or "sync" not in module.imports.values():
            continue
        uses_once = any(
            other.kind == SymbolKind.FUNCTION
            and other.parent_symbol_id == symbol.parent_symbol_id
            and "Do" in other.references
            and symbol.name in other.assigned_identifiers
            for other in graph.symbols.values()
        )
        if not uses_once:
            continue
        pointee_name = symbol.references[0] if symbol.references else symbol.name
        target_id = index.class_id_by_name.get(pointee_name, symbol_id)
        instances.append(
            PatternInstance(
                id=f"singleton::{symbol_id}",
                type=PatternType.SINGLETON,
                name=f"Singleton — {pointee_name}",
                confidence=0.6,
                participants=[_participant(graph, target_id, PatternRole.INSTANCE)],
                relations=[],
            )
        )
    return instances


def _detect_observer(index: _Index) -> list[PatternInstance]:
    graph = index.graph
    instances: list[PatternInstance] = []
    for symbol_id, shape in index.sorted_shapes:
        appended = {attr for method in shape.methods.values() for attr in method.appends_list_attrs}
        iterated = {attr for method in shape.methods.values() for attr in method.iterates_attrs}
        if not (appended & iterated):
            continue
        instances.append(
            PatternInstance(
                id=f"observer::{symbol_id}",
                type=PatternType.OBSERVER,
                name=f"Observer — {graph.symbols[symbol_id].name}",
                confidence=0.45,
                participants=[_participant(graph, symbol_id, PatternRole.SUBJECT)],
                relations=[],
            )
        )
    return instances


def _is_repository_like(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(suffix) for suffix in (*_REPOSITORY_SUFFIXES, "interface"))


_TEST_DOUBLE_NAME_PREFIXES = ("Test", "Fake", "Mock", "Stub")


def _is_interface_named(name: str) -> bool:
    """"I" followed by an uppercase letter, so "Inventory..." isn't mistaken for an interface."""
    return len(name) > 1 and name[0] == "I" and name[1].isupper()


def _strip_naming_prefix(name: str) -> str:
    """Strips a leading interface/test-double naming marker so same-family classes correlate."""
    if _is_interface_named(name):
        return name[1:]
    for prefix in _TEST_DOUBLE_NAME_PREFIXES:
        if name.startswith(prefix) and len(name) > len(prefix) and name[len(prefix)].isupper():
            return name[len(prefix) :]
    return name


def _detect_repository(index: _Index) -> list[PatternInstance]:
    """Groups implementations under their shared interface, mirroring _detect_strategy's shape."""
    graph = index.graph
    by_name = index.class_id_by_name
    instances: list[PatternInstance] = []

    grouped_by_interface: dict[str, list[str]] = {}
    standalone: list[str] = []
    for symbol_id, shape in index.sorted_shapes:
        name_lower = graph.symbols[symbol_id].name.lower()
        if not any(name_lower.endswith(suffix) for suffix in _REPOSITORY_SUFFIXES):
            continue
        interface_id = next(
            (
                by_name[base]
                for base in shape.bases
                if base in by_name and _is_repository_like(base)
            ),
            None,
        )
        if interface_id is not None:
            grouped_by_interface.setdefault(interface_id, []).append(symbol_id)
        else:
            standalone.append(symbol_id)

    for interface_id, impl_ids in sorted(grouped_by_interface.items()):
        participants, relations = _interface_impl_group(graph, interface_id, impl_ids)
        instances.append(
            PatternInstance(
                id=f"repository::{interface_id}",
                type=PatternType.REPOSITORY,
                name=f"Repository — {graph.symbols[interface_id].name}",
                confidence=0.55,
                participants=participants,
                relations=relations,
            )
        )

    covered_interfaces = set(grouped_by_interface)
    remaining = [symbol_id for symbol_id in standalone if symbol_id not in covered_interfaces]

    # A structurally-satisfied Protocol has no `bases` link -- fall back to naming convention.
    name_families: dict[str, list[str]] = {}
    for symbol_id in remaining:
        family = _strip_naming_prefix(graph.symbols[symbol_id].name)
        name_families.setdefault(family, []).append(symbol_id)

    for family, member_ids in sorted(name_families.items()):
        sorted_members = sorted(member_ids)
        if len(sorted_members) == 1:
            instances.append(
                PatternInstance(
                    id=f"repository::{sorted_members[0]}",
                    type=PatternType.REPOSITORY,
                    name=f"Repository — {graph.symbols[sorted_members[0]].name}",
                    confidence=0.5,
                    participants=[
                        _participant(graph, sorted_members[0], PatternRole.IMPLEMENTATION)
                    ],
                    relations=[],
                )
            )
            continue
        interface_id = next(
            (sid for sid in sorted_members if _is_interface_named(graph.symbols[sid].name)), None
        )
        participants = (
            [_participant(graph, interface_id, PatternRole.INTERFACE)] if interface_id else []
        )
        relations = []
        for symbol_id in sorted_members:
            if symbol_id == interface_id:
                continue
            participants.append(_participant(graph, symbol_id, PatternRole.IMPLEMENTATION))
            if interface_id is not None:
                relations.append(
                    PatternRelation(
                        from_id=symbol_id, to_id=interface_id, kind=PatternRelationKind.IMPLEMENTS
                    )
                )
        anchor_id = interface_id or sorted_members[0]
        instances.append(
            PatternInstance(
                id=f"repository::{anchor_id}",
                type=PatternType.REPOSITORY,
                name=f"Repository — {family}",
                confidence=0.5,
                participants=participants,
                relations=relations,
            )
        )
    return instances


def detect_candidates(graph: Graph) -> list[PatternInstance]:
    """Every heuristic pattern candidate in `graph`, one call per pattern type, all pure/free."""
    index = _build_index(graph)
    return [
        *_detect_strategy(index),
        *_detect_facade(index),
        *_detect_adapter(index),
        *_detect_registry(index),
        *_detect_singleton(index),
        *_detect_singleton_go(index),
        *_detect_observer(index),
        *_detect_repository(index),
    ]
