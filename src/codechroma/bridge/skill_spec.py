"""Registry of composite skill-run kinds (research, epic-brief).

`diagram_registry.DIAGRAMS` wires a diagram *type* (C1, Patterns, and each user-authored custom
type) into the shared generation/serving pipeline; it assumes one artifact per `Workspace` and a
repo-wide route quartet. The remaining composite kinds are keyed by a `job_key`, not a repo id, and
register through this parallel `SkillSpec` instead. Both spec sets feed
`services._build_skill_agents()`: a maintainer adds another kind with one `SkillSpec` entry, no
hand-listing in `_build_skill_agents`.

The `"diagram-type"` kind (the in-app interview that used to author a new custom-diagram-type
library entry) was retired here in the diagram-management unification -- the library it wrote into
is untouched, only the interview agent/routes are gone.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from codechroma.bridge import epic_brief_agent, research_agent
from codechroma.bridge.skill_agent import SkillAgent

__all__ = ["SkillSpec", "COMPOSITE_SPECS"]


@dataclass(frozen=True)
class SkillSpec:
    """One composite skill-run kind's registry entry: how to build its agent."""

    agent_factory: Callable[[], SkillAgent]


COMPOSITE_SPECS: dict[str, SkillSpec] = {
    "research": SkillSpec(
        agent_factory=research_agent.build_agent,
    ),
    "epic-brief": SkillSpec(
        agent_factory=epic_brief_agent.build_agent,
    ),
}
