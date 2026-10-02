"""The Impact diagram: a deterministic slice of the hierarchy around a set of changing nodes.

A huge repo renders as a tangle if you draw all of it. The Impact view instead draws only the
nodes a change touches plus their one-hop neighbours in the dependency graph -- no background, no
whole-repo dump. `resolve_impact` is pure graph traversal: given seed node ids it walks
`DependencyIndex` one step out (callers `dependents_of` and callees `dependencies_of`), collects
every node in that slice, and returns the nodes + the edges that exist *within* the slice. Nothing
is AI-authored; like `change_cards` this is deliberately deterministic and cheap.

The seeds come from two disjoint sources, one per bridge route:
- a git diff (PR/branch) -- changed symbols resolved via `change_cards`;
- a feature's spec files (`plan.md`/`tasks.md` code paths, mined and resolved by
  `impact_context._feature_spec_seeds`).
Both reduce to a set of node ids, which is all `resolve_impact` needs.
"""

from __future__ import annotations

from codechroma.dependencies.digest import (
    DependencyIndex,
    dependencies_of,
    dependents_of,
)
from codechroma.graph.models import Graph


def _node_label(node_id: str, graph: Graph) -> str:
    node = graph.nodes.get(node_id)
    return node.name if node is not None else node_id


def resolve_impact(
    graph: Graph,
    index: DependencyIndex,
    node_ids: list[str],
    *,
    hop: int = 1,
    max_nodes: int = 200,
) -> dict:
    """The Impact-shaped payload: the seed nodes, one hop of neighbours, and the slice's edges.

    Each seed is tagged so the canvas can mark *why* a box is here (a direct change vs just a
    caller/callee pulled in by it). A seed that names a node missing from the graph is dropped
    rather than rendered as a broken box -- same honesty rule as `change_cards`' `unassigned`, but
    here the drop is silent because the user asked for a slice, not a change report.
    """
    seeds = sorted({nid for nid in node_ids if nid in graph.nodes})

    # BFS out from the seeds, `hop` steps, never revisiting. Ward off runaway growth with max_nodes.
    members: set[str] = set(seeds)
    frontier = list(seeds)
    for _ in range(max(0, hop)):
        if len(members) >= max_nodes:
            break
        next_frontier: list[str] = []
        for node_id in frontier:
            for nid in _neighbours(index, node_id):
                # Neighbours are graph ids by construction — only "already visited" can skip one.
                if nid in members:
                    continue
                members.add(nid)
                next_frontier.append(nid)
                if len(members) >= max_nodes:
                    break
        frontier = next_frontier
        if not frontier:
            break

    nodes = [
        {
            "id": node_id,
            "name": _node_label(node_id, graph),
            "seed": node_id in seeds,
            "node_id": node_id,
        }
        for node_id in sorted(members)
    ]

    # Only edges whose both ends are inside the slice: the changed area plus its immediate
    # surroundings, nothing wider.
    relations = [
        {"from": node_id, "to": dep_id}
        for node_id in sorted(members)
        for dep_id in dependencies_of(index, node_id)
        if dep_id in members and dep_id != node_id
    ]

    return {
        "nodes": nodes,
        "relations": relations,
        "seed_count": len(seeds),
        "node_count": len(nodes),
        "truncated": len(members) >= max_nodes,
    }


def _neighbours(index: DependencyIndex, node_id: str) -> list[str]:
    """A node's callers and callees, so the slice reaches both sides of each seed."""
    return sorted(set(dependents_of(index, node_id)) | set(dependencies_of(index, node_id)))
