"""Unit tests for the per-call-site assignment store (src/codechroma/llm/call_site_settings.py)."""

import pytest

from codechroma.llm.call_site_settings import (
    blocking_call_sites,
    clear_assignment,
    clear_group_assignment,
    load_assignment,
    load_group_assignment,
    save_assignment,
    save_group_assignment,
    validate,
    validate_group,
)
from codechroma.llm.call_sites import CALL_SITES, GROUPS, group_of
from codechroma.llm.providers_store import create_provider


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setenv("codechroma_LLM_PROVIDERS_FILE", str(tmp_path / "providers.json"))
    monkeypatch.setenv("codechroma_LLM_CALL_SITE_SETTINGS_FILE", str(tmp_path / "call-sites.json"))


@pytest.fixture
def api_provider():
    return create_provider({
        "label": "Local", "kind": "api", "transport": "openai-compatible",
        "base_url": "http://localhost:11434/v1", "is_local": True,
    })


@pytest.fixture
def cli_provider():
    return create_provider({"label": "Claude CLI", "kind": "cli", "adapter": "claude"})


def test_every_agentic_call_site_is_in_exactly_one_group():
    agentic_ids = {id_ for id_, site in CALL_SITES.items() if site.capability == "agentic"}
    grouped_ids = {member for group in GROUPS.values() for member in group.members}

    assert agentic_ids == grouped_ids
    assert len(grouped_ids) == sum(len(group.members) for group in GROUPS.values())


def test_group_of_is_none_for_simple_call_site():
    assert group_of("ai_summarizer") is None


def test_group_of_resolves_agentic_call_site():
    assert group_of("c1_agent") == "diagrams"


def test_unassigned_call_site_has_no_assignment():
    assert load_assignment("ai_summarizer") is None


def test_save_then_load_roundtrips(api_provider):
    save_assignment("ai_summarizer", {
        "provider_id": api_provider.id, "model": "llama3", "mode": "api",
    })

    loaded = load_assignment("ai_summarizer")
    assert loaded.provider_id == api_provider.id
    assert loaded.model == "llama3"
    assert loaded.mode == "api"


def test_clear_assignment_removes_it(api_provider):
    save_assignment("ai_summarizer", {
        "provider_id": api_provider.id, "model": "llama3", "mode": "api",
    })

    clear_assignment("ai_summarizer")

    assert load_assignment("ai_summarizer") is None


def test_clear_unassigned_call_site_is_a_noop():
    clear_assignment("ai_summarizer")

    assert load_assignment("ai_summarizer") is None


def test_validate_rejects_unknown_call_site(api_provider):
    problems = validate({
        "call_site_id": "not_a_real_site", "provider_id": api_provider.id,
        "model": "m", "mode": "api",
    })

    assert problems


def test_validate_rejects_unknown_provider():
    problems = validate({
        "call_site_id": "ai_summarizer", "provider_id": "nope", "model": "m", "mode": "api",
    })

    assert problems


def test_validate_rejects_agentic_call_site_outright(cli_provider):
    problems = validate({
        "call_site_id": "research_agent", "provider_id": cli_provider.id,
        "model": "m", "mode": "cli",
    })

    assert problems
    assert "research" in problems[0]


def test_validate_rejects_mode_provider_kind_mismatch(api_provider):
    problems = validate({
        "call_site_id": "ai_summarizer", "provider_id": api_provider.id,
        "model": "m", "mode": "cli",
    })

    assert problems


def test_blocking_call_sites_lists_assigned_call_sites(api_provider):
    save_assignment("ai_summarizer", {
        "provider_id": api_provider.id, "model": "llama3", "mode": "api",
    })

    assert blocking_call_sites(api_provider.id) == ["ai_summarizer"]


def test_blocking_call_sites_empty_for_unused_provider(api_provider):
    assert blocking_call_sites(api_provider.id) == []


def test_save_assignment_raises_on_invalid_payload():
    with pytest.raises(ValueError):
        save_assignment("ai_summarizer", {"provider_id": "nope", "model": "m", "mode": "api"})


def test_save_assignment_raises_on_agentic_call_site(cli_provider):
    with pytest.raises(ValueError):
        save_assignment("research_agent", {
            "provider_id": cli_provider.id, "model": "m", "mode": "cli",
        })


def test_unassigned_group_has_no_assignment():
    assert load_group_assignment("diagrams") is None


def test_save_group_then_load_roundtrips(cli_provider):
    save_group_assignment("diagrams", {"provider_id": cli_provider.id, "model": "claude-opus"})

    loaded = load_group_assignment("diagrams")
    assert loaded.provider_id == cli_provider.id
    assert loaded.model == "claude-opus"


def test_group_assignment_resolves_every_member(cli_provider):
    save_group_assignment("diagrams", {"provider_id": cli_provider.id, "model": "claude-opus"})

    for member in GROUPS["diagrams"].members:
        assignment = load_assignment(member)
        assert assignment.provider_id == cli_provider.id
        assert assignment.model == "claude-opus"
        assert assignment.mode == "cli"


def test_clear_group_assignment_removes_it(cli_provider):
    save_group_assignment("diagrams", {"provider_id": cli_provider.id, "model": "claude-opus"})

    clear_group_assignment("diagrams")

    assert load_group_assignment("diagrams") is None
    assert load_assignment("c1_agent") is None


def test_validate_group_rejects_unknown_group(cli_provider):
    problems = validate_group({
        "group_id": "not_a_real_group", "provider_id": cli_provider.id, "model": "m",
    })

    assert problems


def test_validate_group_rejects_api_provider(api_provider):
    problems = validate_group({
        "group_id": "diagrams", "provider_id": api_provider.id, "model": "m",
    })

    assert problems


def test_save_group_assignment_raises_on_invalid_payload():
    with pytest.raises(ValueError):
        save_group_assignment("diagrams", {"provider_id": "nope", "model": "m"})


def test_blocking_call_sites_includes_every_group_member(cli_provider):
    save_group_assignment("diagrams", {"provider_id": cli_provider.id, "model": "claude-opus"})

    assert set(blocking_call_sites(cli_provider.id)) == set(GROUPS["diagrams"].members)


def test_simple_and_group_assignments_coexist(api_provider, cli_provider):
    save_assignment("ai_summarizer", {
        "provider_id": api_provider.id, "model": "llama3", "mode": "api",
    })
    save_group_assignment("diagrams", {"provider_id": cli_provider.id, "model": "claude-opus"})

    assert load_assignment("ai_summarizer").provider_id == api_provider.id
    assert load_assignment("c1_agent").provider_id == cli_provider.id
