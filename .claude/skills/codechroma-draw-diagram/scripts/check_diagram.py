#!/usr/bin/env python3
"""Verifies one resolved Code Atlas diagram -- C1, Patterns, Impact or Custom -- before success.

Run after writing the diagram file. Reads the bridge's already-resolved diagram rather than the file
on disk, so it checks what the canvas will actually render; --json falls back to the raw file and
silently skips every check that needs a second bridge route. Stdlib only -- it runs inside the
analyzed repo, where codechroma itself is not importable.

Exit tiers:
  0 OK          the diagram resolves and passes every shape check; advisories may still print
  1 BROKEN      BROKEN, DANGLING, SELF -- it points at nothing and draws nowhere
  3 SHAPE       SHALLOW FLAT LISTING SINGLETON BARE VAGUE UNCOVERED DUPLICATE DUPLICATE-PATH
                NOARROWS ORPHAN ISLAND SPARSE UNREVIEWED CROWDED EDGEBOMB LONGLABEL
  2 UNREADABLE  the diagram could not be read at all

The blocking tier means a block points at nothing and renders as a dead end -- DANGLING and SELF are
the same failure for a relation endpoint, since the bridge drops the arrow and it is drawn nowhere.
The shape tier means everything resolves but the diagram still isn't doing its job: it stops above
where the skill's rules say it should, repeats an id, strands a node, or is too dense to read.
--shape-advisory demotes the whole shape tier to advisory, for the case where you can tell the user
why a finding cannot apply.

Advisory findings print but never change the exit code: COVERAGE, DEPTH, NESTING-EDGE, BADKIND,
BADICON, UNLABELED, DROPPED, NOSTATUS, BADSTATUS. COVERAGE is advisory by construction, not by
concession -- the bridge hangs everything no block names off the system box as an "Unmapped code"
remainder, so uncovered code is always reachable and the finding is only about how much of the
repo has no *name*; it also counts every file equally, so a repo whose tests and docs outnumber its
can sit under the threshold with every line of real code named. DEPTH is advisory because the bridge
already drops what is past the cap, NESTING-EDGE because it is a judgement call, and BADKIND/BADICON
because an unrecognized `kind`/`icon` degrades to no icon rather than to a broken block. DROPPED
just
relays the bridge's own resolve-time diagnostics. NOSTATUS/BADSTATUS relay an Impact box whose
`meta.status` is missing or not one of the four values the skill/canvas expect.

037-total-diagram-unification: replaces the four per-kind `_inspect_*` functions with a
two-strategy dispatch (`_inspect_hierarchical`/`_inspect_flat`) keyed by each kind's own
`checks.shape`, mirroring `bridge/inspect.py`'s design (research.md Decision 5). This script
cannot *import* that module (it runs stdlib-only inside the analyzed repo -- see above), so the
two strategies are a synchronized copy, not a shared import; c1/patterns/impact's `CheckConfig`
values are baked into `_BUILTIN_CHECKS` below (mirrored from `diagrams/registry.py` -- keep the
two in sync), and a custom type's own `checks` is fetched from `GET /diagram-types/{type_id}` --
the same JSON-only authoring path proves
SC-001: a brand-new type gets checked correctly with no change to this script. The three checks that
need a *live* bridge probe (C1's coverage-gap advisory and UNCOVERED sub-directory probe, impact's
ancestor-existence probe) stay this script's own job -- `bridge/inspect.py` is pure, in-process, and
never makes them (Constitution I).
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

_FETCH_TIMEOUT_SECONDS = 10
# http.client's errors are not OSError, so a truncated reply would crash instead of being reported.
_FETCH_ERRORS = (OSError, urllib.error.URLError, http.client.HTTPException, ValueError)

MIN_COVERED_PERCENT = 50
COVERAGE_GAPS_SHOWN = 5
FLAT_CHILD_COUNT = 4
FLAT_MAX_DEPTH = 2
LISTING_CHILD_COUNT = 3
UNCOVERED_PROBE_LIMIT = 40
# I/O-bound requests against a local bridge -- no external rate limit to respect.
PROBE_MAX_WORKERS = 8
# Below this a diagram is a stub whose nesting isn't yet a dependency chain worth wiring.
NOARROWS_MIN_DEPTH = 2
NOARROWS_MIN_BLOCKS = 8
MIN_BLOCKS_FOR_DEPTH = 12
# Below this ratio (diagram nodes / density-source classes), the run reproduced the same thinness.
MIN_COVERAGE_RATIO = 0.15
MIN_CLASSES_FOR_SPARSE_CHECK = 8
# Below this, it's a single unconnected id (ORPHAN's job for nodes[]), not an isolated cluster.
MIN_ISLAND_SIZE = 2

KNOWN_KINDS = frozenset(
    {"api", "ui", "service", "database", "queue", "cache", "worker", "auth"}
)

# Mirrors web/src/icons/brands.generated.ts — keep in sync if that file's curated slug list changes.
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

VAGUE_NAMES = frozenset(
    {
        "utils", "util", "utilities", "helpers", "helper", "core", "misc", "other", "others",
        "common", "shared", "stuff", "various", "general",
    }
)

_PATTERNS_ISLAND_HINT = (
    "wire in the real caller (or whatever else connects it to the rest of the diagram, don't stop"
    " at the external system/dependency it wraps"
)
_CUSTOM_ISLAND_HINT = (
    "wire in whatever connects it to the rest of the diagram, or merge/drop the cluster"
)
_C1_ISLAND_HINT = (
    "add the missing arrow to `system` (or another actor already wired to it), or drop it"
)
_IMPACT_ISLAND_HINT = "wire it into the rest of the slice, or drop the cluster"
_CUSTOM_BUDGET = {
    "max_nodes": 60, "max_relations": 100, "max_name_chars": 40, "max_edge_label_chars": 50,
}

# Mirrored from src/codechroma/diagrams/registry.py's BUILTIN_TYPES -- keep the two in sync.
_BUILTIN_CHECKS = {
    "c1": {
        "shape": "hierarchical",
        "budgets": {
            "max_nodes": 60, "max_relations": 60, "max_name_chars": 40, "max_edge_label_chars": 50,
        },
        "min_depth": 5,
        "unlabeled": "shape",
        "coverage_source": None,
        "density_source": None,
        "required_meta": [],
        "membership_source": None,
        "allow_self": False,
        "check_islands": {"hint": _C1_ISLAND_HINT},
        # 042: c1 is a flat system-context view now -- no decomposed actors left to be BARE about.
        "check_bare_actors": False,
    },
    "patterns": {
        "shape": "flat",
        "budgets": {
            "max_nodes": 45, "max_relations": 70, "max_name_chars": 40, "max_edge_label_chars": 50,
        },
        "min_depth": None,
        "unlabeled": "advisory",
        "coverage_source": None,
        "density_source": "patterns",
        "required_meta": ["confirmed"],
        "membership_source": None,
        "allow_self": True,
        "check_islands": {"hint": _PATTERNS_ISLAND_HINT},
    },
    "impact": {
        "shape": "flat",
        "budgets": {
            "max_nodes": 25, "max_relations": 40, "max_name_chars": 40, "max_edge_label_chars": 40,
        },
        # Not part of the density family's 4-column table (drawing-rules.md) -- impact only.
        "max_hero_edges": 2,
        "min_depth": None,
        "unlabeled": "advisory",
        "coverage_source": None,
        "density_source": None,
        "required_meta": [],
        "membership_source": {"ancestor_prefixes": ["dir::", "component::"]},
        "allow_self": False,
        "check_islands": {"hint": _IMPACT_ISLAND_HINT},
    },
}

_INSTANCE_KIND = "pattern-instance"

# The per-kind budget table, flat like drawing-rules.md's table -- what the drift check compares.
_BUDGETS = {kind: checks["budgets"] for kind, checks in _BUILTIN_CHECKS.items()} | {
    "custom": _CUSTOM_BUDGET,
}


@dataclass
class _Report:
    """Broken and shape lines both fail the run; advisories only ever print."""

    broken: list[str] = field(default_factory=list)
    shape: list[str] = field(default_factory=list)
    advisories: list[str] = field(default_factory=list)
    node_count: int = 0
    relation_count: int = 0
    hero_count: int = 0
    leaves: int = 0
    blocks: int = 0
    depth: int = 0
    # bare id -> every entry claiming it, and path -> every entry claiming it; both must be unique.
    ids: dict[str, list[str]] = field(default_factory=dict)
    paths: dict[str, list[str]] = field(default_factory=dict)
    # instance ids the resolver still serves as unconfirmed -- never addressed, not pending.
    unreviewed: list[str] = field(default_factory=list)
    names: list[tuple[str, str]] = field(default_factory=list)
    edge_labels: list[tuple[str, str]] = field(default_factory=list)
    # c1's own ORPHAN pair: every leaf block/actor id, and which of them a relation touched.
    leaf_trails: set[str] = field(default_factory=set)
    touched: set[str] = field(default_factory=set)
    paths_by_trail: dict[str, str | None] = field(default_factory=dict)

    def note_id(self, entry_id: str, path: str | None = None) -> None:
        """Records one flat-diagram entry -- every kind now addresses entries by bare id (036)."""
        self.ids.setdefault(entry_id, []).append(entry_id)
        if path:
            self.paths.setdefault(path, []).append(entry_id)

    def note_name(self, entry_id: str, name: object) -> None:
        """Collects one box label for the LONGLABEL budget."""
        if isinstance(name, str) and name.strip():
            self.names.append((entry_id, name.strip()))


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        diagram = _load_diagram(args)
        diagram_style = diagram.get("style") if isinstance(diagram, dict) else None
        checks = _resolve_checks(args, diagram_style)
        inspect_fn = _inspect_hierarchical if checks["shape"] == "hierarchical" else _inspect_flat
        report = inspect_fn(diagram, checks, args)
    except _FETCH_ERRORS as exc:
        print(f"ERROR could not read the diagram: {exc}", file=sys.stderr)
        return 2

    _check_density(checks["budgets"], diagram_style, args.kind, report)
    _check_hero_budget(checks, report)
    _check_impact_status(diagram, args.kind, report)
    if not args.json_path:
        _check_diagnostics(diagram, report)

    for line in report.advisories + report.shape + report.broken:
        print(line)
    if report.broken:
        print(f"FAILED {len(report.broken)} entr(y/ies) do not resolve to a graph node")
        return 1
    if report.shape and not args.shape_advisory:
        print(f"NEEDS WORK {len(report.shape)} shape issue(s) — fix the lines above, or rerun with")
        print("           --shape-advisory once you can tell the user why a finding cannot apply")
        return 3
    if checks["shape"] == "hierarchical":
        print(f"OK: {report.leaves} leaves resolved, max authored depth {report.depth}")
    else:
        print(f"OK: {report.node_count} node(s) resolved")
    return 0


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check one resolved Code Atlas diagram.")
    default_url = os.environ.get("CODECHROMA_BRIDGE_URL", "http://localhost:8000")
    default_repo = os.environ.get("CODECHROMA_WORKSPACE_ID", "") or "default"
    kinds = sorted({*_BUILTIN_CHECKS, "custom", "feature-plan"})
    parser.add_argument("--kind", required=True, choices=kinds, help="diagram kind")
    parser.add_argument("--url", default=default_url, help="bridge base URL")
    parser.add_argument("--repo", default=default_repo, help="repo id in the bridge route")
    parser.add_argument("--json", dest="json_path", help="read a raw file instead of the bridge")
    parser.add_argument("--type", dest="type_id", help="diagram type id (required for custom)")
    parser.add_argument("--slug", help="feature-plan slug (required for --kind feature-plan)")
    parser.add_argument("--source", default="diff", choices=("diff", "plan"), help="impact slice")
    parser.add_argument("--feature", help="feature dir (impact-context&feature=) for a plan slice")
    parser.add_argument(
        "--shape-advisory",
        action="store_true",
        help="report shape findings without failing the run",
    )
    args = parser.parse_args(argv)
    if args.kind == "custom" and not args.type_id:
        parser.error("--type is required for --kind custom")
    if args.kind == "feature-plan" and not args.slug:
        parser.error("--slug is required for --kind feature-plan")
    return args


def _load_diagram(args: argparse.Namespace) -> object:
    if args.json_path:
        with open(args.json_path, encoding="utf-8") as handle:
            return json.load(handle)
    return _fetch_json(_diagram_url(args))


def _diagram_url(args: argparse.Namespace) -> str:
    """The bridge route that resolves this kind -- the same one the canvas renders from."""
    base = f"{args.url.rstrip('/')}/repos/{args.repo}"
    if args.kind == "custom":
        return f"{base}/custom/{args.type_id}"
    if args.kind == "feature-plan":
        return f"{base}/feature-plan/{args.slug}"
    if args.kind == "impact":
        return f"{base}/impact?source={args.source}"
    return f"{base}/{args.kind}"


def _context_url(args: argparse.Namespace) -> str:
    """Same routing as `_diagram_url`, one path segment further -- the unified context envelope."""
    base = f"{args.url.rstrip('/')}/repos/{args.repo}"
    if args.kind == "custom":
        return f"{base}/custom/{args.type_id}/context"
    return f"{base}/{args.kind}/context"


def _fetch_json(url: str) -> object:
    """One bridge GET — raises, so each caller decides whether a failure is fatal or just silent."""
    with urllib.request.urlopen(url, timeout=_FETCH_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def _resolve_checks(args: argparse.Namespace, diagram_style: object) -> dict:
    """This kind's `CheckConfig`-shaped dict -- baked in for built-ins, fetched for custom."""
    builtin = _BUILTIN_CHECKS.get(args.kind)
    if builtin is not None:
        return builtin
    if args.kind == "feature-plan":
        # No saved definition to fetch from -- every Feature plan is the same flat shape.
        return _default_flat_checks(diagram_style)
    return _fetch_custom_checks(args, diagram_style)


def _default_flat_checks(diagram_style: object) -> dict:
    """FR-011's safe default -- today's actual custom-type behavior when no `checks` is authored."""
    return {
        "shape": "flat",
        "budgets": _CUSTOM_BUDGET,
        "min_depth": None,
        "unlabeled": "advisory",
        "coverage_source": None,
        "density_source": None,
        "required_meta": [],
        "membership_source": None,
        "allow_self": diagram_style == "dependency-graph",
        "check_islands": {"hint": _CUSTOM_ISLAND_HINT},
    }


def _fetch_custom_checks(args: argparse.Namespace, diagram_style: object) -> dict:
    """A custom type's own `checks`, from `GET /diagram-types/{id}` -- proves SC-001 (zero code)."""
    raw: object = None
    if not args.json_path:
        try:
            definition = _fetch_json(f"{args.url.rstrip('/')}/diagram-types/{args.type_id}")
        except _FETCH_ERRORS:
            definition = None
        if isinstance(definition, dict):
            raw = definition.get("checks")
    if isinstance(raw, dict) and raw.get("shape") in ("hierarchical", "flat"):
        return {
            "shape": raw["shape"],
            "budgets": raw.get("budgets") or _CUSTOM_BUDGET,
            "min_depth": raw.get("min_depth"),
            "unlabeled": raw.get("unlabeled") or "advisory",
            "coverage_source": raw.get("coverage_source"),
            "density_source": raw.get("density_source"),
            "required_meta": raw.get("required_meta") or [],
            "membership_source": raw.get("membership_source"),
            "allow_self": bool(raw.get("allow_self")),
            "check_islands": raw.get("check_islands"),
            "check_bare_actors": raw.get("check_bare_actors", True),
        }
    return _default_flat_checks(diagram_style)


def _not_an_object(report: _Report) -> _Report:
    report.broken.append("BROKEN <root> the diagram is not a JSON object")
    return report


def _note_flat_entry(
    entry: object, report: _Report, noun: str, allow_node_ids: bool = False
) -> None:
    """Records one flat-diagram entry, flagging a `path` the bridge could not resolve to a node."""
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
    relation: object, endpoints: list[tuple[str, str]], touched: set[str], report: _Report
) -> None:
    """Collects one relation's endpoints plus its label, for the density budgets."""
    if not isinstance(relation, dict):
        return
    source, target = relation.get("from"), relation.get("to")
    if not isinstance(source, str) or not isinstance(target, str):
        return
    endpoints.append((source, target))
    touched.add(source)
    touched.add(target)
    _note_edge_label(relation, source, target, report)


def _note_edge_label(relation: dict, source: object, target: object, report: _Report) -> None:
    """Counts one relation (+ hero flag) and keeps its label, for the density/hero budgets."""
    report.relation_count += 1
    if relation.get("hero") is True:
        report.hero_count += 1
    label = relation.get("label")
    if isinstance(label, str) and label.strip():
        report.edge_labels.append((f"{source} -> {target}", label.strip()))


def _check_duplicates(report: _Report, noun: str) -> None:
    """A bare id must address one entry, and a repo path must have one home on the diagram."""
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
    endpoints: list[tuple[str, str]], report: _Report, allow_self: bool, noun: str
) -> None:
    """Every endpoint must name a real entry, and (outside dependency graphs) not name itself."""
    for source, target in endpoints:
        pair = f"{source!r} -> {target!r}"
        if source == target:
            if not allow_self:
                report.broken.append(f"SELF {pair} connects a {noun} to itself")
            continue
        for role, entry_id in (("from", source), ("to", target)):
            if entry_id not in report.ids:
                report.broken.append(f"DANGLING {pair} {role}={entry_id!r} matches no {noun}")


def _check_c1_orphans(report: _Report) -> None:
    """Same shape as `_check_orphans`, over the c1-only `leaf_trails`/`touched` pair."""
    for trail in sorted(report.leaf_trails - report.touched):
        path = report.paths_by_trail.get(trail)
        report.shape.append(
            f"ORPHAN {trail!r} path={path or '<none>'} has no relationship to anything else"
        )


def _check_c1_islands(nodes: list[dict], diagram: dict, report: _Report, hint: str) -> None:
    """Unlike `_check_islands`, c1 has a root -- any component without `"system"` is an island."""
    ids = set(report.ids)
    if "system" not in ids:
        return
    endpoints: list[tuple[str, str]] = []
    for node in nodes:
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


def _check_orphans(nodes: object, touched: set[str], report: _Report) -> None:
    """A free-standing node with no relation connects to nothing on the canvas."""
    for node in nodes if isinstance(nodes, list) else []:
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        if isinstance(node_id, str) and node_id and node_id not in touched:
            report.shape.append(f"ORPHAN {node_id!r} has no relationship to anything else")


def _connected_components(ids: set[str], endpoints: list[tuple[str, str]]) -> list[set[str]]:
    """Groups every id into a component via undirected reachability over the given relations."""
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


def _check_islands(endpoints: list[tuple[str, str]], report: _Report, hint: str) -> None:
    """An adapter wired only to the external system it wraps is still an island."""
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


def _check_density(budgets: dict, style: object, kind: str, report: _Report) -> None:
    """Readability budgets -- an over-budget diagram is unreadable before it is ever wrong."""
    # Same style-aware precedent as custom's SELF exemption: a dependency graph is meant to be big.
    counts_apply = not (kind == "custom" and style == "dependency-graph")
    if counts_apply and report.node_count > budgets["max_nodes"]:
        report.shape.append(f"CROWDED {report.node_count} node(s), budget {budgets['max_nodes']}")
    if counts_apply and report.relation_count > budgets["max_relations"]:
        report.shape.append(
            f"EDGEBOMB {report.relation_count} relation(s), budget {budgets['max_relations']}"
        )
    for entry_id, name in report.names:
        if len(name) > budgets["max_name_chars"]:
            report.advisories.append(
                f"LONGLABEL {entry_id} {len(name)} chars, budget {budgets['max_name_chars']}"
            )
    for pair, label in report.edge_labels:
        if len(label) > budgets["max_edge_label_chars"]:
            report.advisories.append(
                f"LONGLABEL {pair} {len(label)} chars, budget {budgets['max_edge_label_chars']}"
            )


def _check_hero_budget(checks: dict, report: _Report) -> None:
    """Impact only (gated on the budget key existing): too many hero relations tells no story."""
    limit = checks.get("max_hero_edges")
    count = report.hero_count
    if limit is not None and count > limit:
        report.advisories.append(f"TOOMANYHERO {count} hero relation(s), budget {limit}")


# Tuple, not set: `in` uses `==`, so a non-string `status` degrades to BADSTATUS, not a TypeError.
_IMPACT_STATUS_VALUES = ("new", "modified", "deleted", "context")


def _check_impact_status(diagram: object, kind: str, report: _Report) -> None:
    """Impact only: catches a missing/misspelled `meta.status`, which blanks the chip."""
    if kind != "impact" or not isinstance(diagram, dict):
        return
    nodes = diagram.get("nodes")
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict):
            continue
        meta = node.get("meta")
        status = meta.get("status") if isinstance(meta, dict) else None
        if status is None:
            report.advisories.append(f"NOSTATUS {node.get('id')} has no meta.status")
        elif status not in _IMPACT_STATUS_VALUES:
            report.advisories.append(
                f"BADSTATUS {node.get('id')} status={status!r}, expected {_IMPACT_STATUS_VALUES}"
            )


def _check_unlabeled(unlabeled_severity: str, report: _Report) -> None:
    """One aggregated line, never one per edge -- shape when the type's schema requires a label."""
    total = report.relation_count
    unlabeled = total - len(report.edge_labels)
    if total == 0 or unlabeled * 2 <= total:
        return
    line = f"UNLABELED {unlabeled} of {total} relation(s) carry no label"
    bucket = report.shape if unlabeled_severity == "shape" else report.advisories
    bucket.append(line)


def _check_diagnostics(diagram: object, report: _Report) -> None:
    """Relays what the bridge itself dropped while resolving -- advisory, never a failure."""
    diagnostics = diagram.get("diagnostics") if isinstance(diagram, dict) else None
    if not isinstance(diagnostics, dict) or not diagnostics.get("dropped_count"):
        return
    dropped = diagnostics.get("dropped")
    dropped = dropped if isinstance(dropped, list) else []
    entries = [entry for entry in dropped if isinstance(entry, dict)]
    for entry in entries:
        report.advisories.append(
            f"DROPPED {entry.get('what')} {entry.get('id')} {entry.get('reason')}"
        )
    if not diagnostics.get("truncated"):
        return
    shown = diagnostics.get("shown")
    shown = shown if isinstance(shown, int) else len(entries)
    remaining = int(diagnostics.get("dropped_count") or 0) - shown
    report.advisories.append(f"DROPPED {max(remaining, 0)} more")


def _children_by_parent(nodes: list[dict]) -> dict[str | None, list[dict]]:
    """036: every block is one flat `nodes[]` entry now -- this is the only "tree" that exists."""
    by_parent: dict[str | None, list[dict]] = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        parent = node.get("parent")
        by_parent.setdefault(parent if isinstance(parent, str) else None, []).append(node)
    return by_parent


# --- hierarchical strategy (c1's real tree-walk) ---


def _inspect_hierarchical(diagram: object, checks: dict, args: argparse.Namespace) -> _Report:
    """The C1 tree: every block must resolve, and the tree must actually be decomposed."""
    report = _Report()
    if not isinstance(diagram, dict):
        return _not_an_object(report)
    nodes = diagram.get("nodes")
    nodes = [node for node in nodes if isinstance(node, dict)] if isinstance(nodes, list) else []
    by_id = {node["id"]: node for node in nodes if isinstance(node.get("id"), str)}
    by_parent = _children_by_parent(nodes)
    probe = None if args.json_path else _make_probe(nodes, by_parent, args)

    system = by_id.get("system")
    if system is not None:
        report.note_id("system")
        report.note_name("system", system.get("name"))
        _walk_hierarchical(by_parent, "system", 1, report, checks, probe)
    for node in nodes:
        node_id = node.get("id")
        if not (isinstance(node_id, str) and node_id and node_id != "system"):
            continue
        if node.get("parent") is not None or node.get("kind") not in ("person", "external_system"):
            continue
        _check_actor(node, by_parent, report, checks)
        report.note_id(node_id)
        report.note_name(node_id, node.get("name"))
        # An actor box is checked for a relationship of its own, same as any leaf block.
        report.leaf_trails.add(node_id)
        report.paths_by_trail[node_id] = None
        _walk_hierarchical(by_parent, node_id, 1, report, checks, probe)
    if report.blocks >= MIN_BLOCKS_FOR_DEPTH and report.depth <= FLAT_MAX_DEPTH:
        report.shape.append(
            f"SHALLOW <root> {report.blocks} blocks in only {report.depth} authored layer(s)"
        )
    _check_duplicates(report, "blocks")
    _check_c1_relations(diagram.get("relations"), by_id, report)
    _check_c1_orphans(report)
    if checks.get("check_islands"):
        _check_c1_islands(nodes, diagram, report, checks["check_islands"]["hint"])
    report.node_count = len(report.ids)
    _check_unlabeled(checks["unlabeled"], report)
    if not args.json_path and checks.get("coverage_source"):
        _check_coverage(args, report)
    return report


def _check_coverage(args: argparse.Namespace, report: _Report) -> None:
    """Asks the bridge how much repo code a named block accounts for, and names the biggest gaps."""
    try:
        envelope = _fetch_json(_context_url(args))
    except _FETCH_ERRORS:
        return
    payload = envelope.get("coverage") if isinstance(envelope, dict) else None
    if not isinstance(payload, dict) or not payload.get("total_files"):
        return
    percent = payload.get("percent", 100)
    if not isinstance(percent, int | float) or percent >= MIN_COVERED_PERCENT:
        return
    # Advisory: this counts tests/docs/examples too, so a fully-named repo can still land under it.
    report.advisories.append(
        f"COVERAGE <root> named blocks cover {percent}% of {payload['total_files']} files"
        f" — the rest is only reachable as the unnamed remainder. Biggest gaps: {_gaps(payload)}"
    )


def _gaps(payload: dict) -> str:
    """The uncovered subtrees holding the most files — where naming a block pays off most."""
    entries = payload.get("entries")
    if not isinstance(entries, list):
        return "unknown"
    ranked = sorted(
        (entry for entry in entries if isinstance(entry, dict)),
        key=lambda entry: entry.get("file_count", 0),
        reverse=True,
    )
    named = ", ".join(
        f"{entry.get('path')} ({entry.get('file_count')} files)"
        for entry in ranked[:COVERAGE_GAPS_SHOWN]
    )
    return named or "unknown"


def _check_c1_relations(relations: object, by_id: dict[str, dict], report: _Report) -> None:
    """Same endpoint rules as any flat kind, plus c1's own nesting-edge/no-arrows checks."""
    edges = relations if isinstance(relations, list) else []
    internal = 0
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
        if not valid:
            continue
        if source == target:
            report.broken.append(f"SELF {pair} connects a block to itself")
            continue
        report.touched.add(source)
        report.touched.add(target)
        source_node, target_node = by_id.get(source), by_id.get(target)
        source_nested = bool(source_node and source_node.get("parent"))
        target_nested = bool(target_node and target_node.get("parent"))
        # "Internal" wiring touches a decomposed sub-block, not just two top-level roots.
        if source_nested or target_nested:
            internal += 1
        if source_node and source_node.get("parent") == target:
            report.advisories.append(
                f"NESTING-EDGE {pair} only restates the nesting the box already shows"
            )
        elif target_node and target_node.get("parent") == source:
            report.advisories.append(
                f"NESTING-EDGE {pair} only restates the nesting the box already shows"
            )
    is_substantial = report.depth >= NOARROWS_MIN_DEPTH and report.blocks >= NOARROWS_MIN_BLOCKS
    if is_substantial and internal == 0:
        report.shape.append(
            f"NOARROWS <root> {report.depth} authored layers but no relationship between sub-blocks"
            " — wire the dependency chain you nested (handler -> service -> repository -> adapter)"
        )


def _check_actor(
    actor: dict, by_parent: dict[str | None, list[dict]], report: _Report, checks: dict
) -> None:
    """An external system with no children names a boundary but never says which code crosses it."""
    _check_icon(actor, str(actor.get("id", "?")), report)
    if not checks.get("check_bare_actors", True) or actor.get("kind") != "external_system":
        return
    if not by_parent.get(actor.get("id")):
        report.shape.append(f"BARE {actor.get('id', '?')} external_system actor has no children")


def _walk_hierarchical(
    by_parent: dict[str | None, list[dict]],
    trail: str,
    depth: int,
    report: _Report,
    checks: dict,
    probe: object,
    parent_path: str | None = None,
) -> None:
    children = by_parent.get(trail)
    if not children:
        return
    report.depth = max(report.depth, depth)
    min_depth = checks.get("min_depth")
    if min_depth and depth > min_depth:
        report.advisories.append(f"DEPTH {trail} is below the {min_depth}-layer cap")
    siblings = 0
    leaf_shaped = 0
    enumerated = 0
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
            _walk_hierarchical(by_parent, child_id, depth + 1, report, checks, probe, child_path)
            continue
        leaf_shaped += 1
        report.leaf_trails.add(child_id)
        report.paths_by_trail[child_id] = _clean_path(child.get("path"))
        if _is_enumerated_file(child, parent_path):
            enumerated += 1
        if child.get("node_id"):
            report.leaves += 1
            _check_leaf(child, child_id, report, probe)
        elif _plan_kind(child) in ("add", "create"):
            report.leaves += 1
        elif "node_id" in child or not child.get("path"):
            # An explicit node_id: null (bridge tried and failed) or no path at all is broken.
            report.broken.append(f"BROKEN {child_id} path={child.get('path') or '<none>'}")
        else:
            report.leaves += 1
    if enumerated >= LISTING_CHILD_COUNT:
        report.shape.append(
            f"LISTING {trail} re-lists {enumerated} files already shown by its own {parent_path}"
        )
        return
    if siblings >= FLAT_CHILD_COUNT and leaf_shaped == siblings and depth <= FLAT_MAX_DEPTH:
        report.shape.append(f"FLAT {trail} lists {siblings} leaves with no intermediate layer")


def _clean_path(path: object) -> str | None:
    if not isinstance(path, str) or not path.strip():
        return None
    return path.strip().removeprefix("./").strip("/")


def _is_enumerated_file(child: dict, parent_path: str | None) -> bool:
    """A file leaf directly inside its parent's own directory — a listing the canvas gives free."""
    path = _clean_path(child.get("path"))
    if parent_path is None or path is None or "/" not in path:
        return False
    head, _, tail = path.rpartition("/")
    if head != parent_path:
        return False
    node_id = child.get("node_id")
    return node_id.startswith("component::") if isinstance(node_id, str) else "." in tail


def _check_name(child: dict, trail: str, report: _Report) -> None:
    """A filler name is the skill's own proof that the split was guessed rather than found."""
    name = str(child.get("name") or "").strip()
    report.note_name(trail, name)
    if name.lower() in VAGUE_NAMES:
        report.shape.append(f"VAGUE {trail} name={child.get('name')!r} names no responsibility")


def _check_kind(child: dict, trail: str, report: _Report) -> None:
    """A misspelled kind degrades silently to no icon rather than breaking navigation."""
    kind = child.get("kind")
    if kind is not None and kind not in KNOWN_KINDS:
        report.advisories.append(f"BADKIND {trail} kind={kind!r} is not a recognized icon kind")


def _plan_kind(node: dict) -> str | None:
    """`meta.plan_kind` (add/create/modify/delete) marks a Planned block, distinct from `kind`."""
    meta = node.get("meta")
    value = meta.get("plan_kind") if isinstance(meta, dict) else None
    return value if isinstance(value, str) else None


def _check_icon(block: dict, trail: str, report: _Report) -> None:
    """Same silent-fallback story as _check_kind, for the real-brand-logo slug."""
    icon = block.get("icon")
    if icon is not None and icon not in KNOWN_BRAND_ICONS:
        report.advisories.append(f"BADICON {trail} icon={icon!r} is not a recognized brand icon")


def _dir_leaf_id(child: dict) -> str | None:
    """The `dir::` node id a leaf needs an UNCOVERED probe for, or None if it isn't one."""
    node_id = child.get("node_id")
    if isinstance(node_id, str) and node_id.startswith("dir::"):
        return node_id
    return None


def _check_leaf(child: dict, trail: str, report: _Report, probe: object) -> None:
    """A directory leaf that still holds sub-directories stopped a layer above the stop rule."""
    node_id = _dir_leaf_id(child)
    if not callable(probe) or node_id is None:
        return
    if probe(node_id):
        report.shape.append(f"UNCOVERED {trail} path={child.get('path')} has sub-directories")


def _collect_dir_leaf_ids(
    nodes: list[dict], by_parent: dict[str | None, list[dict]]
) -> list[str]:
    """Every leaf's (no node names it as `parent`) `dir::` id, capped at UNCOVERED_PROBE_LIMIT."""
    ids: list[str] = []
    seen: set[str] = set()
    for node in nodes:
        if len(ids) >= UNCOVERED_PROBE_LIMIT:
            break
        node_id_field = node.get("id")
        if isinstance(node_id_field, str) and by_parent.get(node_id_field):
            continue  # has its own children -- not a leaf
        dir_id = _dir_leaf_id(node)
        if dir_id is not None and dir_id not in seen:
            seen.add(dir_id)
            ids.append(dir_id)
    return ids


def _fetch_has_folder_child(base: str, node_id: str) -> bool:
    """One blocking probe request -- run inside the ThreadPoolExecutor batch, never on the walk."""
    query = urllib.parse.urlencode({"root": node_id, "depth": 1})
    try:
        payload = _fetch_json(f"{base}?{query}")
    except _FETCH_ERRORS:
        return False
    return _has_folder_child(payload)


def _make_probe(
    nodes: list[dict], by_parent: dict[str | None, list[dict]], args: argparse.Namespace
):
    """Fetches every dir:: leaf's probe up front, concurrently -- the walk only reads the cache."""
    base = f"{args.url.rstrip('/')}/repos/{args.repo}/structure"
    ids = _collect_dir_leaf_ids(nodes, by_parent)
    cache: dict[str, bool] = {}
    if ids:
        with ThreadPoolExecutor(max_workers=PROBE_MAX_WORKERS) as pool:
            results = pool.map(lambda node_id: _fetch_has_folder_child(base, node_id), ids)
            cache.update(zip(ids, results, strict=True))

    def probe(node_id: str) -> bool:
        return cache.get(node_id, False)

    return probe


def _has_folder_child(payload: object) -> bool:
    nodes = payload.get("nodes") if isinstance(payload, dict) else None
    if not isinstance(nodes, list):
        return False
    return any(isinstance(node, dict) and node.get("level") == "folder" for node in nodes)


# --- flat strategy (patterns, impact, custom -- already-shared machinery) ---


def _inspect_flat(diagram: object, checks: dict, args: argparse.Namespace) -> _Report:
    """Any flat kind: it must resolve, connect, and not be a thin reproduction of its source."""
    report = _Report()
    if not isinstance(diagram, dict):
        return _not_an_object(report)
    nodes = diagram.get("nodes")
    nodes = [node for node in nodes if isinstance(node, dict)] if isinstance(nodes, list) else []
    required_meta = checks.get("required_meta") or []
    # ORPHAN only ever applies to a free-standing connective node, never an instance/participant.
    free_nodes = []
    for node in nodes:
        _note_flat_entry(node, report, "node", allow_node_ids=True)
        if required_meta and node.get("kind") == _INSTANCE_KIND:
            meta = node.get("meta") if isinstance(node.get("meta"), dict) else {}
            if any(meta.get(field) is None for field in required_meta) and isinstance(
                node.get("id"), str
            ):
                report.unreviewed.append(node["id"])
        elif node.get("parent") is None:
            free_nodes.append(node)
    endpoints: list[tuple[str, str]] = []
    touched: set[str] = set()
    for relation in diagram.get("relations") or []:
        _collect_relation(relation, endpoints, touched, report)
    _check_duplicates(report, "nodes")
    _check_relations(endpoints, report, bool(checks.get("allow_self")), "node")
    _check_orphans(free_nodes, touched, report)
    check_islands = checks.get("check_islands")
    if check_islands:
        _check_islands(endpoints, report, check_islands["hint"])
    if required_meta:
        _check_unreviewed(report)
    _check_unlabeled(checks["unlabeled"], report)
    if not args.json_path:
        if checks.get("density_source"):
            _check_sparse(checks["density_source"], report, args)
        if checks.get("membership_source"):
            _check_membership(checks["membership_source"], nodes, report, args)
    return report


def _check_unreviewed(report: _Report) -> None:
    """A candidate silently omitted from the file re-appears as unconfirmed every run, forever."""
    for entry_id in report.unreviewed:
        report.shape.append(
            f"UNREVIEWED {entry_id!r} was never confirmed or rejected -- write a node with "
            "meta.confirmed: true or meta.confirmed: false; omitting it entirely just makes the "
            "heuristic re-detect it as unconfirmed on every future run"
        )


def _check_sparse(density_source: str, report: _Report, args: argparse.Namespace) -> None:
    """Flags the exact failure mode this skill exists to fix: real classes, near-empty diagram."""
    try:
        context = _fetch_json(f"{args.url.rstrip('/')}/repos/{args.repo}/{density_source}/context")
    except _FETCH_ERRORS:
        return
    generation_data = context.get("generation_data") if isinstance(context, dict) else None
    classes = generation_data.get("classes") if isinstance(generation_data, dict) else None
    class_count = len(classes) if isinstance(classes, list) else 0
    if class_count < MIN_CLASSES_FOR_SPARSE_CHECK:
        return
    if report.node_count < class_count * MIN_COVERAGE_RATIO:
        report.shape.append(
            f"SPARSE {report.node_count} diagram node(s) for {class_count} classes in "
            f"{density_source}'s context -- add the real patterns you found plus the infra/"
            "external nodes that connect them, not just the strongest match"
        )


def _check_membership(
    membership_source: dict, nodes: list[dict], report: _Report, args: argparse.Namespace
) -> None:
    """A concrete box must sit in the slice; an ancestor id skips that but must still exist."""
    prefixes = tuple(membership_source.get("ancestor_prefixes") or ())
    base = f"{args.url.rstrip('/')}/repos/{args.repo}"
    url = f"{base}/impact/context?source={args.source}"
    if args.feature:
        url = f"{url}&feature={args.feature}"
    try:
        ctx = _fetch_json(url)
    except _FETCH_ERRORS:
        return
    generation_data = ctx.get("generation_data") if isinstance(ctx, dict) else None
    raw_nodes = generation_data.get("nodes") if isinstance(generation_data, dict) else None
    slice_ids = {
        node["node_id"]
        for node in (raw_nodes or [])
        if isinstance(node, dict) and isinstance(node.get("node_id"), str)
    }
    for node in nodes:
        entry_id, node_id = node.get("id"), node.get("node_id")
        if not isinstance(node_id, str) or not node_id:
            continue
        is_ancestor = node_id.startswith(prefixes)
        if slice_ids and not is_ancestor and node_id not in slice_ids:
            report.broken.append(
                f"BROKEN {entry_id} (node_id not in the {len(slice_ids)}-node slice)"
            )
        elif is_ancestor and not _node_exists(base, node_id):
            report.broken.append(f"BROKEN {entry_id} (node_id {node_id!r} does not exist)")


def _node_exists(base: str, node_id: str) -> bool:
    """Whether the bridge's own graph has this id -- the check an ancestor prefix used to skip."""
    try:
        _fetch_json(f"{base}/nodes/{node_id}")
        return True
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        raise


if __name__ == "__main__":
    sys.exit(main())
