"""`inspect(diagram, spec) -> Report` -- the two self-check strategies every diagram type shares.

Ported from `.claude/skills/codechroma-draw-diagram/scripts/check_diagram.py`'s four `_inspect_*`
functions (research.md Decision 5): c1's real tree-walk stays `HierarchicalInspector`; patterns',
impact's, and custom's already-shared flat machinery becomes `FlatInspector`, driven by each type's
own `CheckConfig` instead of an `if kind == ...` branch. This module is pure -- no bridge/network
I/O -- so every check runs "from JSON alone" (contracts/inspector-config.md's test obligation).
`check_diagram.py` cannot import this (it runs stdlib-only inside the analyzed repo, per its own
docstring); it keeps its own synchronized copy plus the three probe-dependent checks (C1's coverage
gap and UNCOVERED sub-directory probe, impact's ancestor-existence probe) that need a live bridge
fetch this module deliberately never makes (Constitution I).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from codechroma.diagrams.articulation import articulation_labels
from codechroma.diagrams.registry import CheckConfig
from codechroma.patterns.serialize import INSTANCE_KIND

__all__ = [
    "Report",
    "InspectContext",
    "Inspector",
    "HierarchicalInspector",
    "FlatInspector",
    "INSPECTORS",
    "inspect",
]

VAGUE_NAMES = frozenset(
    {
        "utils", "util", "utilities", "helpers", "helper", "core", "misc", "other", "others",
        "common", "shared", "stuff", "various", "general",
    }
)
KNOWN_KINDS = frozenset({"api", "ui", "service", "database", "queue", "cache", "worker", "auth"})
# Mirrors web/src/icons/brands.generated.ts and check_diagram.py's own copy -- keep in sync.
KNOWN_BRAND_ICONS = frozenset(
    {
        "anthropic", "apachekafka", "auth0", "bitbucket", "circleci", "cloudflare", "confluence",
        "datadog", "digitalocean", "docker", "elastic", "elasticsearch", "figma", "firebase",
        "github", "githubactions", "gitlab", "googlecloud", "grafana", "hubspot", "influxdb",
        "jira", "kubernetes", "mariadb", "mongodb", "mysql", "netlify", "newrelic", "nginx",
        "okta", "pagerduty", "paypal", "postgresql", "prometheus", "rabbitmq", "redis", "render",
        "sentry", "sqlite", "stripe", "supabase", "terraform", "vercel", "zendesk",
    }
)
FLAT_CHILD_COUNT = 4
FLAT_MAX_DEPTH = 2
LISTING_CHILD_COUNT = 3
MIN_BLOCKS_FOR_DEPTH = 12
NOARROWS_MIN_DEPTH = 2
NOARROWS_MIN_BLOCKS = 8
MIN_ISLAND_SIZE = 2
MIN_COVERAGE_RATIO = 0.15
MIN_CLASSES_FOR_SPARSE_CHECK = 8


@dataclass
class Report:
    """Broken and shape lines both fail the run; advisories only ever print."""

    broken: list[str] = field(default_factory=list)
    shape: list[str] = field(default_factory=list)
    advisories: list[str] = field(default_factory=list)
    node_count: int = 0
    relation_count: int = 0
    blocks: int = 0
    depth: int = 0
    ids: dict[str, list[str]] = field(default_factory=dict)
    paths: dict[str, list[str]] = field(default_factory=dict)
    unreviewed: list[str] = field(default_factory=list)
    names: list[tuple[str, str]] = field(default_factory=list)
    edge_labels: list[tuple[str, str]] = field(default_factory=list)
    leaf_trails: set[str] = field(default_factory=set)
    touched: set[str] = field(default_factory=set)
    paths_by_trail: dict[str, str | None] = field(default_factory=dict)

    def note_id(self, entry_id: str, path: str | None = None) -> None:
        self.ids.setdefault(entry_id, []).append(entry_id)
        if path:
            self.paths.setdefault(path, []).append(entry_id)

    def note_name(self, entry_id: str, name: object) -> None:
        if isinstance(name, str) and name.strip():
            self.names.append((entry_id, name.strip()))


@dataclass
class InspectContext:
    """Optional, already-fetched data a live caller may supply; every field defaults to "skip"."""

    coverage: dict | None = None
    generation_data: dict | None = None
    dir_probe: Callable[[str], bool] | None = None
    slice_ids: set[str] | None = None
    exists_probe: Callable[[str], bool] | None = None


class Inspector:
    """Protocol: `inspect(diagram, spec, context) -> Report`."""

    def inspect(self, diagram: object, spec: CheckConfig, context: InspectContext) -> Report:
        raise NotImplementedError

    @staticmethod
    def _valid_nodes(diagram: object, report: Report) -> list[dict] | None:
        """Shared `inspect()` preamble: dict nodes, or None (marks `report`) if `diagram` is bad."""
        if not isinstance(diagram, dict):
            _not_an_object(report)
            return None
        nodes = diagram.get("nodes")
        return [n for n in nodes if isinstance(n, dict)] if isinstance(nodes, list) else []


# --- shared helpers, ported verbatim from check_diagram.py ---


def _not_an_object(report: Report) -> Report:
    report.broken.append("BROKEN <root> the diagram is not a JSON object")
    return report


def _children_by_parent(nodes: Sequence[object]) -> dict[str | None, list[dict]]:
    by_parent: dict[str | None, list[dict]] = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        parent = node.get("parent")
        by_parent.setdefault(parent if isinstance(parent, str) else None, []).append(node)
    return by_parent


def _clean_path(path: object) -> str | None:
    if not isinstance(path, str) or not path.strip():
        return None
    return path.strip().removeprefix("./").strip("/")


def _note_flat_entry(
    entry: object, report: Report, noun: str, allow_node_ids: bool = False
) -> None:
    if not isinstance(entry, dict):
        report.broken.append(f"BROKEN a {noun} entry is not a JSON object")
        return
    report.node_count += 1
    entry_id = entry.get("id")
    if isinstance(entry_id, str):
        report.note_id(entry_id)
        report.note_name(entry_id, entry.get("name") or entry.get("label"))
    path = entry.get("path")
    resolved = entry.get("node_id") or (entry.get("node_ids") if allow_node_ids else None)
    if path and not resolved:
        report.broken.append(f"BROKEN {entry_id!r} path={path!r} has no resolved node_id")


def _collect_relation(
    relation: object, endpoints: list[tuple[str, str]], touched: set[str], report: Report
) -> None:
    if not isinstance(relation, dict):
        return
    source, target = relation.get("from"), relation.get("to")
    if not isinstance(source, str) or not isinstance(target, str):
        return
    endpoints.append((source, target))
    touched.add(source)
    touched.add(target)
    _note_edge_label(relation, source, target, report)


def _note_edge_label(relation: dict, source: object, target: object, report: Report) -> None:
    report.relation_count += 1
    label = relation.get("label")
    if isinstance(label, str) and label.strip():
        report.edge_labels.append((f"{source} -> {target}", label.strip()))


def _check_duplicates(report: Report, noun: str) -> None:
    for entry_id, claims in sorted(report.ids.items()):
        if len(claims) > 1:
            report.shape.append(
                f"DUPLICATE {entry_id!r} is claimed by {len(claims)} {noun}"
                " -- relations address entries by bare id, so give each one its own"
            )
    for path, claims in sorted(report.paths.items()):
        if len(claims) > 1:
            report.shape.append(
                f"DUPLICATE-PATH {path} is claimed by {', '.join(sorted(claims))}"
                " -- give it one home and reach it from the other with a relationship"
            )


def _check_relations(
    endpoints: list[tuple[str, str]], report: Report, allow_self: bool, noun: str
) -> None:
    for source, target in endpoints:
        pair = f"{source!r} -> {target!r}"
        if source == target:
            if not allow_self:
                report.broken.append(f"SELF {pair} connects a {noun} to itself")
            continue
        for role, entry_id in (("from", source), ("to", target)):
            if entry_id not in report.ids:
                report.broken.append(f"DANGLING {pair} {role}={entry_id!r} matches no {noun}")


def _check_orphans(nodes: list[dict], touched: set[str], report: Report) -> None:
    for node in nodes:
        node_id = node.get("id")
        if isinstance(node_id, str) and node_id and node_id not in touched:
            report.shape.append(f"ORPHAN {node_id!r} has no relationship to anything else")


def _connected_components(ids: set[str], endpoints: list[tuple[str, str]]) -> list[set[str]]:
    adjacency: dict[str, set[str]] = {entry_id: set() for entry_id in ids}
    for source, target in endpoints:
        if source == target or source not in ids or target not in ids:
            continue
        adjacency[source].add(target)
        adjacency[target].add(source)
    seen: set[str] = set()
    components: list[set[str]] = []
    for start in sorted(ids):
        if start in seen:
            continue
        component: set[str] = set()
        stack = [start]
        while stack:
            current = stack.pop()
            if current in component:
                continue
            component.add(current)
            stack.extend(adjacency[current] - component)
        seen |= component
        components.append(component)
    return components


def _check_islands(endpoints: list[tuple[str, str]], report: Report, hint: str) -> None:
    ids = set(report.ids)
    if not ids:
        return
    components = _connected_components(ids, endpoints)
    islands = [component for component in components if len(component) >= MIN_ISLAND_SIZE]
    if len(islands) <= 1:
        return
    islands.sort(key=lambda component: (-len(component), sorted(component)))
    for component in islands[1:]:
        members = ", ".join(repr(member) for member in sorted(component))
        report.shape.append(
            f"ISLAND {members} ({len(component)} entries) relates only to itself -- {hint}"
        )


def _check_articulation(endpoints: list[tuple[str, str]], report: Report) -> None:
    """Flags critical nodes (`bridge`/`hub`) as an advisory -- they never change the exit code."""
    for node, label in sorted(articulation_labels(endpoints).items()):
        report.advisories.append(
            f"ARTICULATION {node!r} is a {label}: removing it breaks the diagram"
        )


def _check_unlabeled(unlabeled_severity: str, report: Report) -> None:
    total = report.relation_count
    unlabeled = total - len(report.edge_labels)
    if total == 0 or unlabeled * 2 <= total:
        return
    line = f"UNLABELED {unlabeled} of {total} relation(s) carry no label"
    bucket = report.shape if unlabeled_severity == "shape" else report.advisories
    bucket.append(line)


def _check_density(budgets: dict, unlabeled_severity: str, report: Report) -> None:
    if budgets.get("max_nodes") and report.node_count > budgets["max_nodes"]:
        report.shape.append(f"CROWDED {report.node_count} node(s), budget {budgets['max_nodes']}")
    if budgets.get("max_relations") and report.relation_count > budgets["max_relations"]:
        report.shape.append(
            f"EDGEBOMB {report.relation_count} relation(s), budget {budgets['max_relations']}"
        )
    for entry_id, name in report.names:
        if budgets.get("max_name_chars") and len(name) > budgets["max_name_chars"]:
            report.advisories.append(
                f"LONGLABEL {entry_id} {len(name)} chars, budget {budgets['max_name_chars']}"
            )
    for pair, label in report.edge_labels:
        if budgets.get("max_edge_label_chars") and len(label) > budgets["max_edge_label_chars"]:
            report.advisories.append(
                f"LONGLABEL {pair} {len(label)} chars, budget {budgets['max_edge_label_chars']}"
            )
    _check_unlabeled(unlabeled_severity, report)


def _check_icon(block: dict, trail: str, report: Report) -> None:
    icon = block.get("icon")
    if icon is not None and icon not in KNOWN_BRAND_ICONS:
        report.advisories.append(f"BADICON {trail} icon={icon!r} is not a recognized brand icon")


def _check_kind(child: dict, trail: str, report: Report) -> None:
    kind = child.get("kind")
    if kind is not None and kind not in KNOWN_KINDS:
        report.advisories.append(f"BADKIND {trail} kind={kind!r} is not a recognized icon kind")


def _meta_str(node: dict, key: str) -> str | None:
    """A string `meta[key]`, or `None` if `meta` is missing, not a dict, or not a string there."""
    meta = node.get("meta")
    value = meta.get(key) if isinstance(meta, dict) else None
    return value if isinstance(value, str) else None


def _plan_kind(node: dict) -> str | None:
    """`meta.plan_kind` (add/create/modify/delete) marks a Planned block, distinct from `kind`."""
    return _meta_str(node, "plan_kind")


def _no_code_reason(node: dict) -> str | None:
    """`meta.no_code_reason` from diagram_resolver.py, or `None` if never resolved live."""
    return _meta_str(node, "no_code_reason")


def _check_name(child: dict, trail: str, report: Report) -> None:
    name = str(child.get("name") or "").strip()
    report.note_name(trail, name)
    if name.lower() in VAGUE_NAMES:
        report.shape.append(f"VAGUE {trail} name={child.get('name')!r} names no responsibility")


class FlatInspector(Inspector):
    """Patterns, impact, custom -- shared duplicates/relations/orphans/islands machinery."""

    def inspect(self, diagram: object, spec: CheckConfig, context: InspectContext) -> Report:
        report = Report()
        nodes = self._valid_nodes(diagram, report)
        if nodes is None:
            return report
        free_nodes = self._collect_nodes(nodes, spec, report)
        endpoints: list[tuple[str, str]] = []
        touched: set[str] = set()
        assert isinstance(diagram, dict)  # guaranteed by _valid_nodes returning non-None above
        for relation in diagram.get("relations") or []:
            _collect_relation(relation, endpoints, touched, report)
        noun = "entry" if spec.required_meta else "node"
        _check_duplicates(report, "nodes")
        _check_relations(endpoints, report, spec.allow_self, noun)
        _check_articulation(endpoints, report)
        _check_orphans(free_nodes, touched, report)
        if spec.check_islands:
            _check_islands(endpoints, report, spec.check_islands["hint"])
        self._check_unreviewed(report)
        _check_density(spec.budgets, spec.unlabeled, report)
        self._check_sparse(spec, report, context)
        self._check_membership(spec, nodes, report, context)
        return report

    def _collect_nodes(self, nodes: list[dict], spec: CheckConfig, report: Report) -> list[dict]:
        """Only free-standing nodes are ORPHAN candidates -- instance/participant ones never are."""
        free_nodes = []
        for node in nodes:
            _note_flat_entry(node, report, "node", allow_node_ids=True)
            if spec.required_meta and node.get("kind") == INSTANCE_KIND:
                raw_meta = node.get("meta")
                meta: dict = raw_meta if isinstance(raw_meta, dict) else {}
                if any(meta.get(field) is None for field in spec.required_meta):
                    if isinstance(node.get("id"), str):
                        report.unreviewed.append(node["id"])
            elif node.get("parent") is None:
                free_nodes.append(node)
        return free_nodes

    def _check_unreviewed(self, report: Report) -> None:
        for entry_id in report.unreviewed:
            report.shape.append(
                f"UNREVIEWED {entry_id!r} was never confirmed or rejected -- write a node with "
                "meta.confirmed: true or meta.confirmed: false; omitting it entirely just makes "
                "the heuristic re-detect it as unconfirmed on every future run"
            )

    def _check_sparse(self, spec: CheckConfig, report: Report, context: InspectContext) -> None:
        if not spec.density_source or context.generation_data is None:
            return
        classes = context.generation_data.get("classes")
        class_count = len(classes) if isinstance(classes, list) else 0
        if class_count < MIN_CLASSES_FOR_SPARSE_CHECK:
            return
        if report.node_count < class_count * MIN_COVERAGE_RATIO:
            report.shape.append(
                f"SPARSE {report.node_count} diagram node(s) for {class_count} classes in "
                f"{spec.density_source}'s context -- add the real patterns you found plus the "
                "infra/external nodes that connect them, not just the strongest match"
            )

    def _check_membership(
        self, spec: CheckConfig, nodes: list[dict], report: Report, context: InspectContext
    ) -> None:
        if not spec.membership_source or context.slice_ids is None:
            return
        prefixes = tuple(spec.membership_source.get("ancestor_prefixes") or ())
        for node in nodes:
            entry_id, node_id = node.get("id"), node.get("node_id")
            if not isinstance(node_id, str) or not node_id:
                continue
            is_ancestor = node_id.startswith(prefixes)
            if not is_ancestor and node_id not in context.slice_ids:
                report.broken.append(f"BROKEN {entry_id} (node_id not in the slice)")
            elif is_ancestor and context.exists_probe and not context.exists_probe(node_id):
                report.broken.append(f"BROKEN {entry_id} (node_id does not exist)")


class HierarchicalInspector(Inspector):
    """C1's real tree-walk -- `_walk_c1`/`_check_actor`/`_check_leaf`/its own relation check."""

    def inspect(self, diagram: object, spec: CheckConfig, context: InspectContext) -> Report:
        report = Report()
        nodes = self._valid_nodes(diagram, report)
        if nodes is None:
            return report
        by_id = {n["id"]: n for n in nodes if isinstance(n.get("id"), str)}
        by_parent = _children_by_parent(nodes)

        system = by_id.get("system")
        if system is not None:
            report.note_id("system")
            report.note_name("system", system.get("name"))
            self._walk(by_parent, "system", 1, report, spec, context)
        for node in nodes:
            node_id = node.get("id")
            if not (isinstance(node_id, str) and node_id and node_id != "system"):
                continue
            if node.get("parent") is not None or node.get("kind") not in (
                "person", "external_system",
            ):
                continue
            self._check_actor(node, by_parent, report, spec)
            report.note_id(node_id)
            report.note_name(node_id, node.get("name"))
            report.leaf_trails.add(node_id)
            report.paths_by_trail[node_id] = None
            self._walk(by_parent, node_id, 1, report, spec, context)
        if report.blocks >= MIN_BLOCKS_FOR_DEPTH and report.depth <= FLAT_MAX_DEPTH:
            report.shape.append(
                f"SHALLOW <root> {report.blocks} blocks in only {report.depth} authored layer(s)"
            )
        _check_duplicates(report, "blocks")
        assert isinstance(diagram, dict)  # guaranteed by _valid_nodes returning non-None above
        self._check_relations(diagram.get("relations"), by_id, report)
        self._check_c1_orphans(report)
        if spec.check_islands:
            self._check_c1_islands(nodes, diagram, report, spec.check_islands["hint"])
        report.node_count = len(report.ids)
        _check_density(spec.budgets, spec.unlabeled, report)
        self._check_coverage(spec, report, context)
        return report

    def _check_coverage(self, spec: CheckConfig, report: Report, context: InspectContext) -> None:
        if not spec.coverage_source or context.coverage is None:
            return
        payload = context.coverage
        if not payload.get("total_files"):
            return
        percent = payload.get("percent", 100)
        if not isinstance(percent, int | float) or percent >= 50:
            return
        report.advisories.append(
            f"COVERAGE <root> named blocks cover {percent}% of {payload['total_files']} files"
            " — the rest is only reachable as the unnamed remainder"
        )

    def _check_c1_orphans(self, report: Report) -> None:
        for trail in sorted(report.leaf_trails - report.touched):
            path = report.paths_by_trail.get(trail)
            report.shape.append(
                f"ORPHAN {trail!r} path={path or '<none>'} has no relationship to anything else"
            )

    def _check_c1_islands(
        self, nodes: Sequence[object], diagram: dict, report: Report, hint: str
    ) -> None:
        """Unlike `_check_islands`, c1 has a root -- a component without `"system"` is an island."""
        ids = set(report.ids)
        if "system" not in ids:
            return
        endpoints: list[tuple[str, str]] = []
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_id, parent = node.get("id"), node.get("parent")
            if isinstance(node_id, str) and isinstance(parent, str):
                endpoints.append((node_id, parent))
        for relation in diagram.get("relations") or []:
            if not isinstance(relation, dict):
                continue
            source, target = relation.get("from"), relation.get("to")
            if isinstance(source, str) and isinstance(target, str):
                endpoints.append((source, target))
        components = _connected_components(ids, endpoints)
        islands = [c for c in components if len(c) >= MIN_ISLAND_SIZE and "system" not in c]
        for component in sorted(islands, key=sorted):
            members = ", ".join(repr(member) for member in sorted(component))
            report.shape.append(
                f"ISLAND {members} ({len(component)} entries) relates only to itself -- {hint}"
            )

    def _check_relations(self, relations: object, by_id: dict[str, dict], report: Report) -> None:
        edges = relations if isinstance(relations, list) else []
        internal = 0
        endpoints: list[tuple[str, str]] = []
        for edge in edges:
            if not isinstance(edge, dict):
                report.broken.append("BROKEN relations contains a non-object entry")
                continue
            source, target = edge.get("from"), edge.get("to")
            _note_edge_label(edge, source, target, report)
            pair = f"{source!r} -> {target!r}"
            valid = True
            for role, entry_id in (("from", source), ("to", target)):
                if not (isinstance(entry_id, str) and entry_id in report.ids):
                    report.broken.append(f"DANGLING {pair} {role}={entry_id!r} matches no block")
                    valid = False
            if not valid or not isinstance(source, str) or not isinstance(target, str):
                continue
            if source == target:
                report.broken.append(f"SELF {pair} connects a block to itself")
                continue
            endpoints.append((source, target))
            report.touched.add(source)
            report.touched.add(target)
            source_node, target_node = by_id.get(source), by_id.get(target)
            source_nested = bool(source_node and source_node.get("parent"))
            target_nested = bool(target_node and target_node.get("parent"))
            if source_nested or target_nested:
                internal += 1
            nests = (source_node and source_node.get("parent") == target) or (
                target_node and target_node.get("parent") == source
            )
            if nests:
                report.advisories.append(
                    f"NESTING-EDGE {pair} only restates the nesting the box already shows"
                )
        _check_articulation(endpoints, report)
        is_substantial = report.depth >= NOARROWS_MIN_DEPTH and report.blocks >= NOARROWS_MIN_BLOCKS
        if is_substantial and internal == 0:
            report.shape.append(
                f"NOARROWS <root> {report.depth} authored layers but no relationship between "
                "sub-blocks — wire the dependency chain you nested "
                "(handler -> service -> repository -> adapter)"
            )

    def _check_actor(
        self,
        actor: dict,
        by_parent: dict[str | None, list[dict]],
        report: Report,
        spec: CheckConfig,
    ) -> None:
        _check_icon(actor, str(actor.get("id", "?")), report)
        if not spec.check_bare_actors or actor.get("kind") != "external_system":
            return
        if not by_parent.get(actor.get("id")):
            actor_id = actor.get("id", "?")
            report.shape.append(f"BARE {actor_id} external_system actor has no children")

    def _walk(
        self,
        by_parent: dict[str | None, list[dict]],
        trail: str,
        depth: int,
        report: Report,
        spec: CheckConfig,
        context: InspectContext,
        parent_path: str | None = None,
    ) -> None:
        children = by_parent.get(trail)
        if not children:
            return
        report.depth = max(report.depth, depth)
        if spec.min_depth and depth > spec.min_depth:
            report.advisories.append(f"DEPTH {trail} is below the {spec.min_depth}-layer cap")
        siblings = leaf_shaped = enumerated = 0
        for child in children:
            siblings += 1
            report.blocks += 1
            child_id = child.get("id")
            child_id = str(child_id) if isinstance(child_id, str) and child_id else "?"
            report.note_id(child_id, _clean_path(child.get("path")))
            _check_name(child, child_id, report)
            _check_kind(child, child_id, report)
            _check_icon(child, child_id, report)
            nested = by_parent.get(child_id)
            if nested:
                if len(nested) == 1:
                    report.shape.append(f"SINGLETON {child_id} has one child — collapse the group")
                child_path = _clean_path(child.get("path"))
                self._walk(by_parent, child_id, depth + 1, report, spec, context, child_path)
                continue
            leaf_shaped += 1
            report.leaf_trails.add(child_id)
            report.paths_by_trail[child_id] = _clean_path(child.get("path"))
            if self._is_enumerated_file(child, parent_path):
                enumerated += 1
            if child.get("node_id"):
                self._check_leaf(child, child_id, report, context)
            else:
                reason = _no_code_reason(child)
                if reason is not None:
                    is_broken = reason == "unresolved"
                elif _plan_kind(child) in ("add", "create"):
                    is_broken = False  # fallback: this diagram never went through resolve_diagram()
                else:
                    is_broken = "node_id" in child or not child.get("path")
                if is_broken:
                    report.broken.append(f"BROKEN {child_id} path={child.get('path') or '<none>'}")
        if enumerated >= LISTING_CHILD_COUNT:
            report.shape.append(
                f"LISTING {trail} re-lists {enumerated} files already shown by {parent_path}"
            )
            return
        if siblings >= FLAT_CHILD_COUNT and leaf_shaped == siblings and depth <= FLAT_MAX_DEPTH:
            report.shape.append(f"FLAT {trail} lists {siblings} leaves with no intermediate layer")

    def _is_enumerated_file(self, child: dict, parent_path: str | None) -> bool:
        path = _clean_path(child.get("path"))
        if parent_path is None or path is None or "/" not in path:
            return False
        head, _, tail = path.rpartition("/")
        if head != parent_path:
            return False
        node_id = child.get("node_id")
        return node_id.startswith("component::") if isinstance(node_id, str) else "." in tail

    def _check_leaf(self, child: dict, trail: str, report: Report, context: InspectContext) -> None:
        node_id = child.get("node_id")
        if not (isinstance(node_id, str) and node_id.startswith("dir::")):
            return
        if context.dir_probe is not None and context.dir_probe(node_id):
            report.shape.append(f"UNCOVERED {trail} path={child.get('path')} has sub-directories")


INSPECTORS: dict[str, Inspector] = {
    "hierarchical": HierarchicalInspector(),
    "flat": FlatInspector(),
}


def inspect(diagram: object, spec: CheckConfig, context: InspectContext | None = None) -> Report:
    """Dispatches to the strategy `spec.shape` names -- unknown shapes read as `flat`."""
    strategy = INSPECTORS.get(spec.shape, INSPECTORS["flat"])
    return strategy.inspect(diagram, spec, context or InspectContext())
