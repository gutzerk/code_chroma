"""Script-gathered structural material for the codechroma-patterns skill.

Everything here already lives in the in-memory graph -- no new extraction, just a read-only view
formatted for a headless `claude -p` run: every class's shape (bases/decorators/methods and their
extracted signals), its resolved dependency edges, and the current heuristic pattern candidates as
a seed list the skill confirms/extends rather than re-deriving from scratch. Mirrors
context/digest.py's role for the C1 diagram.
"""

from __future__ import annotations

from codechroma.dependencies.digest import (
    DependencyIndex,
    build_dependency_index,
    dependencies_of,
    dependents_of,
)
from codechroma.engine import GraphEngine
from codechroma.graph.models import ClassShape, Graph, MethodShape
from codechroma.patterns.serialize import serialize_instance

__all__ = ["build_patterns_context"]


def _method_entry(name: str, shape: MethodShape) -> dict:
    return {
        "name": name,
        "decorators": shape.decorators,
        "reads_dict_attrs": shape.reads_dict_attrs,
        "writes_dict_attrs": shape.writes_dict_attrs,
        "appends_list_attrs": shape.appends_list_attrs,
        "iterates_attrs": shape.iterates_attrs,
        "sets_class_attr": shape.sets_class_attr,
        "checks_none_class_attr": shape.checks_none_class_attr,
        "calls_on_attr": shape.calls_on_attr,
    }


def _class_entry(
    index: DependencyIndex, graph: Graph, symbol_id: str, shape: ClassShape
) -> dict | None:
    """One class's shape plus its resolved call edges, or None if its symbol is gone."""
    symbol = graph.symbols.get(symbol_id)
    if symbol is None:
        return None
    node_id = symbol_id if symbol_id in graph.nodes else None
    calls = dependencies_of(index, node_id) if node_id else []
    called_by = dependents_of(index, node_id) if node_id else []
    return {
        "id": symbol_id,
        "name": symbol.name,
        "qualified_name": symbol.qualified_name,
        "path": symbol.file_path,
        "node_id": node_id,
        "bases": shape.bases,
        "decorators": shape.decorators,
        "is_abstract": shape.is_abstract,
        "class_attrs": shape.class_attrs,
        "methods": [_method_entry(name, method) for name, method in sorted(shape.methods.items())],
        "calls": calls,
        "called_by": called_by,
    }


def build_patterns_context(engine: GraphEngine, graph: Graph) -> dict:
    """The payload GET /repos/{id}/patterns-context returns to the codechroma-patterns skill."""
    index = build_dependency_index(graph)
    classes = [
        entry
        for symbol_id, shape in sorted(graph.class_shapes.items())
        if (entry := _class_entry(index, graph, symbol_id, shape)) is not None
    ]
    return {
        "classes": classes,
        "heuristic_candidates": [
            serialize_instance(instance) for instance in graph.pattern_candidates
        ],
    }
