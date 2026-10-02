"""Registry of diagram types (C1, Patterns, ...) sharing one generation/serving pipeline.

Each `DiagramSpec` wires a diagram type's own context-gathering/prompt/resolver functions into the
plumbing already built once and shared across types: `SkillAgent` (the AI run engine), `FileWatcher`
(live updates), `Workspace`'s generic diagram methods, and `server.py`'s route factory. Adding a new
diagram type means writing its own context/schema functions and adding one more `DiagramSpec` entry
here -- everything else (SkillAgent run, streaming, snapshot/restore, FileWatcher, HTTP routes,
canvas fetch/subscribe/generate hooks) is already in place.

036-shared-diagram-style-catalog: every `resolve` closure below now calls the one shared
`diagram_resolver.resolve_diagram()` instead of a bespoke per-type function -- this is possible only
because every authored `.codechroma/<kind>.json` is now the one flat `nodes[]`/`relations[]` shape
(`contracts/diagram-schema.md`). That was not true before this feature: C1's nested-tree shape and
Patterns' heuristic-candidate shape were structurally different inputs, which is why this docstring
used to argue against unifying them. Flattening c1's tree and folding patterns' detector output
through `PatternDiagramAdapter` removed that difference, so the four resolver modules collapsed into
one function behind this same `DiagramSpec.resolve` port -- the port itself is unchanged; only what
sits behind each type's closure got smaller. Coverage (c1) and staleness (patterns) are opt-in
add-ons (`attach_coverage`/`attach_staleness`) each closure calls when its type wants them -- see
`specs/036-shared-diagram-style-catalog/research.md` Decision 5.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, cast

from codechroma.bridge.content_generators import build_skill_agent_for, prompt_for
from codechroma.bridge.custom_diagram_resolver import grouping_enabled
from codechroma.bridge.diagram_resolver import attach_coverage, attach_staleness, resolve_diagram
from codechroma.bridge.impact_resolver import impact_path, resolve_impact_diagram
from codechroma.bridge.patterns_resolver import patterns_path, resolve_patterns_diagram
from codechroma.bridge.skill_agent import SkillAgent
from codechroma.context import c1_template, patterns_generator
from codechroma.context.digest import build_context_digest
from codechroma.context.llm_provider import LLMProvider
from codechroma.diagrams import library
from codechroma.diagrams.library import valid_type_id
from codechroma.diagrams.registry import BUILTIN_TYPES
from codechroma.fingerprint import hash_lines

if TYPE_CHECKING:
    from codechroma.bridge.workspaces import Workspace

__all__ = [
    "DiagramSpec",
    "DiagramRegistry",
    "DIAGRAMS",
]


def _digest_fingerprint(ws: Workspace) -> str:
    """A stable hash of the repo's own dependency digest -- custom's staleness signal (FR-005)."""
    digest = ws.load_dependency_digest()
    return hash_lines([json.dumps(digest, sort_keys=True, default=str)])


def _never_generates_spec(
    kind: str,
    artifact_path: Callable[[Path], Path],
    resolve: Callable[[Workspace], dict],
    *,
    agent_error: str,
    has_generate: bool = True,
) -> DiagramSpec:
    """Shared fields for a spec whose artifact is always written directly, never AI-generated."""

    def agent_factory() -> SkillAgent:
        raise NotImplementedError(agent_error)

    return DiagramSpec(
        kind=kind,
        agent_factory=agent_factory,
        root_for=lambda ws: ws.root,
        artifact_path=artifact_path,
        resolve=resolve,
        sync_before_resolve=False,
        has_bootstrap=False,
        bootstrap_context=None,
        generate=None,
        provider_from_env=None,
        supports_only_if_missing=False,
        has_generate=has_generate,
    )


def _resolve_c1(ws: Workspace) -> dict:
    """c1 wants coverage (`unmapped`) on top of the shared resolve -- see FR-006."""
    data = ws.load_diagram("c1")
    if not data:
        return {}
    resolved = resolve_diagram(ws.engine, {**data, "type": "c1"})
    return attach_coverage(resolved, ws.engine)


class DiagramRegistry(dict):
    """dict of built-in specs; `get` also synthesizes a custom-type spec from the library."""

    # Narrower than dict.get's fully generic default on purpose -- every real caller passes none.
    def get(self, kind: str, default: DiagramSpec | None = None) -> DiagramSpec | None:  # type: ignore[override]
        spec = super().get(kind)
        if spec is not None:
            return spec
        if kind.startswith("feature-plan/"):
            slug = kind[len("feature-plan/"):]
            synthesized = self._synthesize_feature_plan(slug) if slug else None
            return synthesized if synthesized is not None else default
        type_id = kind[len("custom/"):] if kind.startswith("custom/") else kind
        synthesized = self._synthesize_custom(type_id) if type_id else None
        return synthesized if synthesized is not None else default

    def __getitem__(self, kind: str) -> DiagramSpec:
        spec = self.get(kind)
        if spec is None:
            raise KeyError(kind)
        return spec

    @staticmethod
    def _keyed_artifact_path(base_dir: Path, key: str) -> Path:
        """`<base_dir>/<key>/<key>.json` -- own subfolder shape shared by custom/feature-plan."""
        return base_dir / key / f"{key}.json"

    def _synthesize_custom(self, type_id: str) -> DiagramSpec | None:
        """A spec for a user-authored diagram type, from its saved library definition."""
        definition = library.load_type(type_id)
        if definition is None:
            return None
        # Resolve reads via `ws.load_diagram(kind)` -> `.codechroma/diagrams/custom/<id>/<id>.json`.
        kind = f"custom/{type_id}"

        def resolve(ws: Workspace) -> dict:
            # Coverage/staleness are opt-in add-ons (FR-005/FR-006); custom had neither before.
            data = ws.load_diagram(kind)
            resolved = resolve_diagram(ws.engine, data, style_source=definition.get("style"))
            resolved["has_diagram"] = bool(data)
            if not grouping_enabled(definition):
                resolved["groups"] = []
            resolved = attach_coverage(resolved, ws.engine)
            reviewed = data.get("fingerprint") if isinstance(data, dict) else None
            return attach_staleness(
                resolved,
                fingerprint=_digest_fingerprint(ws),
                reviewed_fingerprint=reviewed if isinstance(reviewed, str) else None,
            )

        # Custom never auto-generates -- 016 Stage 6 dropped its generate/status/cancel trio.
        return _never_generates_spec(
            kind,
            lambda root: DiagramRegistry._keyed_artifact_path(
                DiagramRegistry.custom_dir(root), type_id
            ),
            resolve,
            agent_error="custom diagram types have no live generate agent",
        )

    @staticmethod
    def custom_dir(root: Path) -> Path:
        """The directory every custom type's own subfolder lives under -- the registry's own."""
        return root / ".codechroma" / "diagrams" / "custom"

    def _synthesize_feature_plan(self, slug: str) -> DiagramSpec | None:
        """A spec for one feature's own Feature-plan diagram, keyed by task identity, not a type."""
        # Unlike custom/<type_id>, any filename-safe slug synthesizes on demand, no saved type.
        if not valid_type_id(slug):
            return None
        kind = f"feature-plan/{slug}"

        def resolve(ws: Workspace) -> dict:
            data = ws.load_diagram(kind)
            resolved = resolve_diagram(ws.engine, data)
            resolved["has_diagram"] = bool(data)
            return resolved

        # Same reasoning as custom: never auto-generates or seeds, always user/agent-initiated.
        return _never_generates_spec(
            kind,
            lambda root: DiagramRegistry._keyed_artifact_path(
                DiagramRegistry.feature_plan_dir(root), slug
            ),
            resolve,
            agent_error="feature-plan diagrams have no live generate agent",
            has_generate=False,
        )

    @staticmethod
    def feature_plan_dir(root: Path) -> Path:
        """The directory every feature's own Feature-plan subfolder lives under, one per task."""
        return root / ".codechroma" / "diagrams" / "feature-plan"


@dataclass(frozen=True)
class DiagramSpec:
    """One diagram type's plug-in points into the shared generation/serving pipeline."""

    kind: str
    # A factory, not an instance: each BridgeServices builds its own runner, so apps never share.
    agent_factory: Callable[[], SkillAgent]
    root_for: Callable[[Workspace], Path]
    artifact_path: Callable[[Path], Path]
    resolve: Callable[[Workspace], dict]
    sync_before_resolve: bool
    has_bootstrap: bool
    bootstrap_context: Callable[[Workspace], object] | None
    generate: Callable[[object, LLMProvider | None], dict | None] | None
    provider_from_env: Callable[[], LLMProvider | None] | None
    supports_only_if_missing: bool
    # A kind needing a per-sponsor prompt (impact's diff/plan slice) names its builder here.
    prompt_for: Callable[[str, str | None], str] | None = None
    # Has a generate/status/cancel/output trio; only "c1" does now (016 Stage 6).
    has_generate: bool = True


DIAGRAMS: DiagramRegistry = DiagramRegistry({
    "c1": DiagramSpec(
        kind="c1",
        agent_factory=lambda: build_skill_agent_for(BUILTIN_TYPES["c1"]),
        root_for=lambda ws: ws.c1_root,
        artifact_path=lambda root: root / BUILTIN_TYPES["c1"].artifact,
        resolve=_resolve_c1,
        sync_before_resolve=False,
        has_bootstrap=True,
        bootstrap_context=lambda ws: build_context_digest(ws.engine, ws.root),
        # A lambda, not a bound reference: tests monkeypatch the *module* attribute at call time.
        generate=lambda payload, provider: c1_template.generate_c1_template(cast(dict, payload)),
        # No credential needed -- a deterministic table lookup, not a model call.
        provider_from_env=None,
        supports_only_if_missing=True,
    ),
    "patterns": DiagramSpec(
        kind="patterns",
        agent_factory=lambda: build_skill_agent_for(BUILTIN_TYPES["patterns"]),
        root_for=lambda ws: ws.root,
        artifact_path=patterns_path,
        resolve=lambda ws: resolve_patterns_diagram(
            ws.engine, ws.engine.snapshot(), ws.load_diagram("patterns")
        ),
        sync_before_resolve=True,
        # No caller left either (016 Stage 6): codechroma-patterns writes patterns.json directly.
        has_generate=False,
        has_bootstrap=True,
        bootstrap_context=lambda ws: ws.engine.snapshot().pattern_candidates,
        generate=lambda payload, provider: patterns_generator.generate_patterns(
            cast(list, payload), provider=provider
        ),
        # A lambda, not a bound reference: tests monkeypatch the *module* attribute at call time.
        provider_from_env=lambda: patterns_generator.provider_from_env(),
        supports_only_if_missing=True,
    ),
    "impact": DiagramSpec(
        kind="impact",
        agent_factory=lambda: build_skill_agent_for(BUILTIN_TYPES["impact"]),
        root_for=lambda ws: ws.root,
        artifact_path=impact_path,
        # Impact re-derives the slice itself (for staleness), so skip the generic pre-resolve sync.
        resolve=resolve_impact_diagram,
        sync_before_resolve=False,
        # No caller left either (016 Stage 6): codechroma-impact writes impact.json directly.
        has_generate=False,
        # Impact never auto-bootstraps or seeds: it is a slice, always user-initiated (like custom).
        has_bootstrap=False,
        bootstrap_context=None,
        generate=None,
        provider_from_env=None,
        # Impact never auto-seeds, so the only_if_missing overwrite-guard cannot apply.
        supports_only_if_missing=False,
        # The skill reads a diff or plan slice, so the generate run carries the chosen sponsor.
        prompt_for=prompt_for("impact"),
    ),
})
