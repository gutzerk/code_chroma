"""The shared base behind the epic-brief runner (the custom-diagram, diagram-type and research
composite kinds this once also covered are all retired -- see `skill_spec.py`'s own docstring).

Each composite-keyed kind builds a `SkillAgent` the same way: a `job_key` that is `{scope}:{item}`
rather than a bare repo id, an artifact path that is the key's item half under a kind-specific dir,
and a `build_agent()` that folds those plus prompt/validate/model into the one `build_skill_agent`
call. This base owns those seams once (Template Method for `build_agent`, Factory Method for the
per-kind `artifact`); a subclass keeps only its prompt, validate, artifact and names. `job_key` is a
`{prefix}:{item}` join so `SkillAgent.forget` can still drop every item a workspace owns.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from codechroma.bridge.skill_agent import SkillAgent, build_skill_agent, item_from_key


class CompositeKeyAgentSpec:
    """A composite-keyed SkillAgent runner: one per (kind, item), keyed by a job_key."""

    # Per-kind plug-ins, set on the subclass.
    kind: str = ""
    name: str = ""
    prompt: str = ""
    validate: Callable[[object], bool] = staticmethod(lambda data: False)
    timeout_env_var: str = ""
    invalid_error: str = ""

    def job_key(self, *parts: str) -> str:
        """The composite key, `{scope}:{item}` -- so `forget(scope)` drops every item it owns."""
        return ":".join(parts)

    def artifact(self, root: Path, key: str) -> Path:
        """Where this kind's skill is expected to write: `{dir}/{item}.json` from a job_key."""
        return self.artifact_dir(root) / f"{item_from_key(key)}.json"

    def artifact_dir(self, root: Path) -> Path:
        """The directory this kind writes one `{item}.json` per job key under."""
        return root

    def build_agent(self) -> SkillAgent:
        """A fresh runner; called once per BridgeServices, never held as module state."""
        return build_skill_agent(
            self.kind,
            name=self.name,
            prompt=self.prompt,
            artifact=self.artifact,
            validate=self.validate,
            timeout_env_var=self.timeout_env_var,
            invalid_error=self.invalid_error,
        )
