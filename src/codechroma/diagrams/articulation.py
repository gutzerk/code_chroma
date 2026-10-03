"""Articulation-point detection over a diagram's `relations[]` endpoints (draw-skills task C).

Labels each node of a relation graph `bridge` or `hub` -- the "critical nodes" a diagram draws
attention to because removing one breaks it or many edges land on it. The result is **advisory
only**: `bridge/inspect.py` reports the labels as `ARTICULATION` self-check advisories in the
terminal. The `meta.critically` stamp and its canvas chip were removed (a bridge/hub box already
visibly converges arrows, so the chip was dead weight). The skill's own self-check
`check_diagram.py` cannot import this -- it runs stdlib-only inside the analyzed repo -- so it keeps
a synchronized copy; keep the logic in both places in agreement.
"""

from __future__ import annotations

# A hub is a node wired to at least this many distinct neighbors (drawing-rules.md's "hub").
ARTICULATION_HUB_DEGREE = 4

__all__ = ["ARTICULATION_HUB_DEGREE", "articulation_labels"]


def _tarjan_scc(adjacency: dict[str, list[str]]) -> list[list[str]]:
    """Tarjan SCC: the strongly-connected components as lists of node ids. Recursion depth is
    bounded by the node count, itself capped by the relation budgets (40-100), so no iterative
    rewrite is needed."""
    index: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    components: list[list[str]] = []
    counter = 0

    def strongconnect(node: str) -> None:
        nonlocal counter
        index[node] = lowlink[node] = counter
        counter += 1
        stack.append(node)
        on_stack.add(node)
        for neighbor in adjacency.get(node, ()):
            if neighbor not in index:
                strongconnect(neighbor)
                lowlink[node] = min(lowlink[node], lowlink[neighbor])
            elif neighbor in on_stack:
                lowlink[node] = min(lowlink[node], index[neighbor])
        if lowlink[node] == index[node]:
            members: list[str] = []
            while True:
                member = stack.pop()
                on_stack.discard(member)
                members.append(member)
                if member == node:
                    break
            components.append(members)

    for node in adjacency:
        if node not in index:
            strongconnect(node)
    return components


def _articulation_points_undirected(neighbors: dict[int, set[int]]) -> set[int]:
    """Tarjan articulation points on an undirected graph (`neighbors` is symmetric): the nodes
    whose removal disconnects their component. Standard low-link DFS."""
    index: dict[int, int] = {}
    low: dict[int, int] = {}
    ap: set[int] = set()
    counter = 0

    def dfs(node: int, parent: int | None) -> None:
        nonlocal counter
        index[node] = low[node] = counter
        counter += 1
        children = 0
        for neighbor in neighbors.get(node, ()):
            if neighbor not in index:
                children += 1
                dfs(neighbor, node)
                low[node] = min(low[node], low[neighbor])
                if parent is None and children > 1:
                    ap.add(node)
                elif parent is not None and low[neighbor] >= index[node]:
                    ap.add(node)
            elif neighbor != parent:
                low[node] = min(low[node], index[neighbor])

    for node in neighbors:
        if node not in index:
            dfs(node, None)
    return ap


def articulation_labels(endpoints: list[tuple[str, str]]) -> dict[str, str]:
    """Node id -> `bridge`/`hub` for every "critical" node, else absent, over the relation graph.

    A **bridge** is a single-node SCC whose condensation node is an articulation point of the
    undirected condensation: removing it disconnects the diagram (a member of a >1 SCC never is,
    since the rest of its cycle stays connected). A **hub** is a node wired to at least
    `ARTICULATION_HUB_DEGREE` distinct neighbors that isn't itself a bridge."""
    directed: dict[str, list[str]] = {}
    undirected: dict[str, set[str]] = {}
    for source, target in endpoints:
        if source == target:
            continue
        directed.setdefault(source, []).append(target)
        directed.setdefault(target, [])
        undirected.setdefault(source, set()).add(target)
        undirected.setdefault(target, set()).add(source)

    components = _tarjan_scc(directed)
    scc_of: dict[str, int] = {}
    scc_size: dict[int, int] = {}
    for scc_index, members in enumerate(components):
        scc_size[scc_index] = len(members)
        for member in members:
            scc_of[member] = scc_index

    # The condensation: one node per SCC, undirected edges between different SCCs.
    cond_edges: list[tuple[int, int]] = []
    for source, targets in directed.items():
        for target in targets:
            si, ti = scc_of[source], scc_of[target]
            if si != ti:
                cond_edges.append((si, ti))
    cond_adj: dict[int, set[int]] = {i: set() for i in scc_size}
    for si, ti in cond_edges:
        cond_adj.setdefault(si, set()).add(ti)
        cond_adj.setdefault(ti, set()).add(si)

    cond_ap = _articulation_points_undirected(cond_adj)

    labels: dict[str, str] = {}
    for node, scc_index in scc_of.items():
        if scc_size[scc_index] != 1:
            continue
        if scc_index in cond_ap:
            labels[node] = "bridge"
    for node in scc_of:
        if node in labels:
            continue
        if len(undirected.get(node, ())) >= ARTICULATION_HUB_DEGREE:
            labels[node] = "hub"
    return labels
