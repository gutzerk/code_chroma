"""codechroma-research's SkillAgent config -- one artifact per question, keyed by a job_key."""

from __future__ import annotations

import hashlib
from pathlib import Path

from codechroma.bridge.composite_agent import CompositeKeyAgentSpec
from codechroma.bridge.remembered import RememberedStore
from codechroma.bridge.skill_agent import SkillAgent
from codechroma.prompts import render_prompt

_MAX_REMEMBERED_QUERIES = 500

TIMEOUT_ENV_VAR = "codechroma_RESEARCH_TIMEOUT_SECONDS"

PROMPT = render_prompt("research_agent")


def query_hash(query: str) -> str:
    """A stable id for a question -- the same question twice in a row hashes to the same job."""
    return hashlib.sha256(query.strip().lower().encode()).hexdigest()[:16]


class ResearchQueryLog:
    """/context looks a question up by job_key here -- a thin alias over RememberedStore.

    Read semantics preserved: `get()` returns the stored value by reference (its value is a str,
    so nothing mutates), matching the pre-unification behavior.
    """

    def __init__(self) -> None:
        self._store = RememberedStore[str](_MAX_REMEMBERED_QUERIES)

    def remember(self, key: str, query: str) -> None:
        self._store.remember(key, query)

    def get(self, key: str) -> str | None:
        return self._store.get(key)


def research_answers_dir(repo_root: Path) -> Path:
    return repo_root / ".codechroma" / "research" / "answers"


def research_answer_path(repo_root: Path, key: str) -> Path:
    """Where the skill is expected to write -- one file per question, keyed off `job_key`'s hash."""
    return _SPEC.artifact(repo_root, key)


def _has_valid_answer(data: object) -> bool:
    return isinstance(data, dict) and isinstance(data.get("answer"), str)


class ResearchAgentSpec(CompositeKeyAgentSpec):
    """Research's plug-in points -- what a question-keyed runner doesn't share with the rest."""

    kind = "research"
    name = "research_agent"
    prompt = PROMPT
    validate = staticmethod(_has_valid_answer)
    timeout_env_var = TIMEOUT_ENV_VAR
    invalid_error = "synthesis produced no valid answer"

    # Deliberately narrower than the base's generic *parts -- see composite_agent.py's docstring.
    def job_key(self, workspace_id: str, query: str) -> str:  # type: ignore[override]
        return f"{workspace_id}:{query_hash(query)}"

    def artifact_dir(self, root: Path) -> Path:
        return research_answers_dir(root)


_SPEC = ResearchAgentSpec()


def job_key(workspace_id: str, query: str) -> str:
    return _SPEC.job_key(workspace_id, query)


def build_agent() -> SkillAgent:
    """A fresh research runner; called once per BridgeServices, never held as module state."""
    return _SPEC.build_agent()
