"""The shared review flow's backend support -- one `GET /repos/{id}/{kind}/review` shape (data-
model.md's `ReviewResult`) and one headless-agent factory, dispatched by `review.agent_factory`
instead of hardcoded to a single kind (037-total-diagram-unification, US3, T045).

Replaces `c1_review_agent.py`: `build_review_agent()` generalizes its `build_agent()` body (kind,
artifact path, prompt and timeout become parameters instead of hand-listed constants), registered by
name in `REVIEW_AGENT_FACTORIES` and looked up from each type's `DiagramTypeDefinition.review.
agent_factory` -- the same named-registry shape every other 037 seam uses. Only `"impact-changes"`
registered today (moved here from `"c1-changes"` post-038, since the diff-only review now lives on
`impact` -- see docs/architecture/diagram-skills.md): `_REVIEW_RESOLVERS` is still keyed by
`agent_factory` name so a second axis can join later, but the judgmental review axis was removed
(038 follow-up) rather than kept half-wired.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

from codechroma.bridge.overlays import impact_changes_path, resolve_impact_changes
from codechroma.bridge.skill_agent import SkillAgent, build_skill_agent
from codechroma.diagrams.registry import get_definition
from codechroma.prompts import render_prompt

if TYPE_CHECKING:
    from codechroma.bridge.workspaces import Workspace

__all__ = [
    "IMPACT_REVIEW_TIMEOUT_ENV_VAR",
    "REVIEW_AGENT_FACTORIES",
    "build_review_agent",
    "resolve_review",
]

IMPACT_REVIEW_TIMEOUT_ENV_VAR = "codechroma_IMPACT_REVIEW_TIMEOUT_SECONDS"


def _has_valid_review(data: object) -> bool:
    """A review is usable as soon as it's an object -- every field in it is optional."""
    return isinstance(data, dict)


def build_review_agent(
    *,
    skill_run_kind: str,
    artifact_path: Callable[[Path], Path],
    prompt: str,
    timeout_env_var: str,
    invalid_error: str,
) -> SkillAgent:
    """A fresh headless review runner -- generalizes `c1_review_agent.build_agent()`'s body."""
    return build_skill_agent(
        skill_run_kind,
        name=f"{skill_run_kind}_review_agent",
        prompt=prompt,
        artifact=lambda root, _repo_id: artifact_path(root),
        validate=_has_valid_review,
        timeout_env_var=timeout_env_var,
        invalid_error=invalid_error,
    )


REVIEW_AGENT_FACTORIES: dict[str, Callable[[], SkillAgent]] = {
    "impact-changes": lambda: build_review_agent(
        skill_run_kind="impact-changes",
        artifact_path=impact_changes_path,
        prompt=render_prompt("impact_review_agent"),
        timeout_env_var=IMPACT_REVIEW_TIMEOUT_ENV_VAR,
        invalid_error="review produced no valid impact-changes.json",
    ),
}


def _explanatory_result(ws: Workspace, kind: str) -> dict:
    """axis="explanatory": reshape impact blocks into `ReviewResult` entries."""
    outcome = resolve_impact_changes(
        ws.root, ws.load_diagram(kind), ws.load_impact_changes(), base=ws.diff_base(),
        engine=ws.engine,
    )
    entries = [
        {
            "node_id": block["node_id"],
            "explanation": {
                "before": block["before"], "after": block["after"], "status": block["status"],
                "change_count": block["change_count"],
            },
            "severity": None,
        }
        for block in outcome["blocks"]
    ]
    return {
        # The fingerprint the review claims to cover.
        "fingerprint": outcome["reviewed_fingerprint"] or "",
        "stale": outcome["stale"],
        "has_review": outcome["has_review"],
        "summary": outcome["summary"],
        "axis": "explanatory",
        "entries": entries,
        "ghosts": outcome["ghosts"],
        "relationships": outcome["relationships"],
    }


# Keyed by ReviewConfig.agent_factory; an unknown key (no per-kind artifact exists yet) is None.
_REVIEW_RESOLVERS: dict[str, Callable[[Workspace, str], dict]] = {
    "impact-changes": lambda ws, kind: _explanatory_result(ws, kind),
}


def resolve_review(ws: Workspace, kind: str) -> dict | None:
    """The unified `ReviewResult` for any type with a `review` sub-entry; `None` for one without."""
    definition = get_definition(kind)
    if definition is None or definition.review is None:
        return None
    resolver = _REVIEW_RESOLVERS.get(definition.review.agent_factory)
    return resolver(ws, kind) if resolver else None
