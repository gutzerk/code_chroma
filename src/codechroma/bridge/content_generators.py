"""Named `ContentGenerator`s -- the two genuinely algorithmic diagram-content producers, by name.

Patterns' heuristic detector and Impact's dependency-graph slicer are the "irreducible" pieces
plan.md's Design Pattern 1 calls out: unlike c1/custom's skill-driven generation, they run
deterministically, in-process, over the already-analyzed graph -- no model call, no I/O. Registering
them by name lets US1 (T018) delete the per-type agent-closure plumbing without losing these two
algorithms; the closures themselves move to `diagrams/registry.py`'s data-driven entries.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from codechroma.bridge.diagram_diagnostics import entries_are_usable
from codechroma.bridge.impact import resolve_impact
from codechroma.bridge.impact_context import normalize_source
from codechroma.bridge.skill_agent import SkillAgent, build_skill_agent
from codechroma.dependencies.digest import build_dependency_index
from codechroma.graph.models import PatternInstance
from codechroma.prompts import render_prompt

if TYPE_CHECKING:
    from codechroma.diagrams.registry import DiagramTypeDefinition
    from codechroma.graph.models import Graph

__all__ = [
    "ContentGenerator",
    "CONTENT_GENERATORS",
    "register_content_generator",
    "build_skill_agent_for",
    "prompt_for",
]


class ContentGenerator(Protocol):
    def generate(self, graph: Graph, **kwargs: object) -> object: ...


class _PatternsDetector:
    """The candidates `patterns/detector.py` already found for free on every `analyze()`."""

    def generate(self, graph: Graph, **_kwargs: object) -> list[PatternInstance]:
        return graph.pattern_candidates


class _ImpactSlicer:
    """`impact.py::resolve_impact` -- pure BFS over the dependency graph, no model call."""

    def generate(self, graph: Graph, **kwargs: object) -> dict:
        node_ids = kwargs.get("node_ids") or []
        hop = kwargs.get("hop", 1)
        index = build_dependency_index(graph)
        return resolve_impact(graph, index, node_ids, hop=hop)  # type: ignore[arg-type]


CONTENT_GENERATORS: dict[str, ContentGenerator] = {
    "patterns": _PatternsDetector(),
    "impact": _ImpactSlicer(),
}


def register_content_generator(name: str, generator: ContentGenerator) -> None:
    CONTENT_GENERATORS[name] = generator


def _has_valid_flat_diagram(data: object) -> bool:
    """A flat nodes[] diagram, not still the unreviewed bootstrap draft, with no unusable nodes."""
    return isinstance(data, dict) and not data.get("draft") and entries_are_usable(data, "nodes")


# Only impact's live run wants a per-request prompt; c1/patterns/custom use the static instructions.
def _impact_prompt(source: str, feature: str | None = None) -> str:
    return render_prompt("impact_agent", source=normalize_source(source), feature=feature or "")


_PROMPT_FOR: dict[str, Callable[[str, str | None], str]] = {"impact": _impact_prompt}


def prompt_for(kind: str) -> Callable[[str, str | None], str] | None:
    """The per-sponsor prompt builder for `kind`, or None when its prompt is static."""
    return _PROMPT_FOR.get(kind)


def build_skill_agent_for(definition: DiagramTypeDefinition) -> SkillAgent:
    """One live `SkillAgent` runner, built entirely from its type's own declarative definition."""
    kind = definition.id

    def artifact(root: Path, _repo_id: str) -> Path:
        return root / definition.artifact

    return build_skill_agent(
        kind,
        name=f"{kind}_agent",
        prompt=definition.instructions,
        artifact=artifact,
        validate=_has_valid_flat_diagram,
        timeout_env_var=f"codechroma_{kind.upper()}_TIMEOUT_SECONDS",
        invalid_error=f"generation produced no valid {kind}.json",
    )
