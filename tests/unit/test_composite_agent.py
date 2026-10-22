"""Unit coverage for CompositeKeyAgentSpec: job keys, artifact paths and agent construction."""

from pathlib import Path

from codechroma.bridge.composite_agent import CompositeKeyAgentSpec
from codechroma.bridge.skill_agent import SkillAgent


class _Spec(CompositeKeyAgentSpec):
    kind = "epic-brief"
    name = "demo-brief"
    prompt = "do the thing"
    timeout_env_var = "codechroma_DEMO_TIMEOUT"
    invalid_error = "bad demo"

    def artifact_dir(self, root: Path) -> Path:
        return root / "demo"


def test_job_key_joins_parts_with_colons():
    key = _Spec().job_key("repo", "LMP-65")

    assert key == "repo:LMP-65"


def test_artifact_uses_the_item_half_of_the_key_under_the_kind_dir(tmp_path):
    path = _Spec().artifact(tmp_path, "repo:LMP-65")

    assert path == tmp_path / "demo" / "LMP-65.json"


def test_artifact_treats_a_bare_key_as_its_own_item(tmp_path):
    path = _Spec().artifact(tmp_path, "solo")

    assert path == tmp_path / "demo" / "solo.json"


def test_base_artifact_dir_is_the_root(tmp_path):
    directory = CompositeKeyAgentSpec().artifact_dir(tmp_path)

    assert directory == tmp_path


def test_base_validate_rejects_everything():
    valid = CompositeKeyAgentSpec().validate({"anything": 1})

    assert valid is False


def test_build_agent_returns_a_fresh_skill_agent_each_call():
    spec = _Spec()

    first, second = spec.build_agent(), spec.build_agent()

    assert isinstance(first, SkillAgent)
    assert first is not second
