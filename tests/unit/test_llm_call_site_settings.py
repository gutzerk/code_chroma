"""Unit tests for the per-call-site assignment store (src/codechroma/llm/call_site_settings.py)."""

import pytest

from codechroma.llm.call_site_settings import (
    blocking_call_sites,
    clear_assignment,
    clear_default,
    clear_group_assignment,
    load_assignment,
    load_default,
    load_group_assignment,
    save_assignment,
    save_default,
    save_group_assignment,
    validate,
    validate_group,
)
from codechroma.llm.call_sites import CALL_SITES, FEATURES, GROUPS, group_of
from codechroma.llm.providers_store import create_provider


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
        "call_site_id": "epic_brief_agent", "provider_id": cli_provider.id,
        "model": "m", "mode": "cli",
    })

    assert problems
    assert "epic_brief" in problems[0]


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


@pytest.fixture
def anthropic_provider():
    return create_provider(
        {"label": "Anthropic", "kind": "api", "transport": "anthropic", "api_key": "sk-x"}
    )


@pytest.fixture
def signed_in_claude():
    return create_provider({"label": "Claude", "kind": "cli", "adapter": "claude"})


def test_default_roundtrips_and_clears(anthropic_provider):
    save_default({"provider_id": anthropic_provider.id, "model": "sonnet"})

    stored = load_default()
    clear_default()

    assert stored is not None and stored.model == "sonnet"
    assert load_default() is None


def test_default_survives_other_saves(anthropic_provider, api_provider):
    save_default({"provider_id": anthropic_provider.id, "model": "sonnet"})

    save_assignment(
        "ai_summarizer", {"provider_id": api_provider.id, "model": "m", "mode": "api"}
    )

    assert load_default() is not None


def test_save_default_rejects_an_unknown_provider():
    with pytest.raises(ValueError):
        save_default({"provider_id": "nope", "model": "m"})


def test_agent_fallback_cannot_be_offline(anthropic_provider):
    with pytest.raises(ValueError):
        save_default({
            "provider_id": anthropic_provider.id, "model": "m",
            "agent_fallback": {"offline": True},
        })


def test_default_applies_to_every_feature_it_can_serve(anthropic_provider):
    save_default({"provider_id": anthropic_provider.id, "model": "sonnet"})

    agentic = load_assignment("c1_agent")
    parallel = load_assignment("parallel_agents")
    simple = load_assignment("ai_summarizer")

    assert (agentic.mode, agentic.provider_id, agentic.model) == (
        "cli", anthropic_provider.id, "sonnet")
    assert parallel.mode == "cli"
    assert (simple.mode, simple.provider_id) == ("api", anthropic_provider.id)


def test_override_beats_the_default(anthropic_provider, api_provider, cli_provider):
    save_default({"provider_id": anthropic_provider.id, "model": "sonnet"})
    save_assignment(
        "ai_summarizer", {"provider_id": api_provider.id, "model": "local", "mode": "api"}
    )
    save_group_assignment("diagrams", {"provider_id": cli_provider.id, "model": "haiku"})

    assert load_assignment("ai_summarizer").provider_id == api_provider.id
    assert load_assignment("c1_agent").provider_id == cli_provider.id
    assert load_assignment("epic_brief_agent").provider_id == anthropic_provider.id


def test_cli_only_default_leaves_quick_features_on_legacy(signed_in_claude):
    save_default({"provider_id": signed_in_claude.id, "model": "sonnet"})

    assert load_assignment("c1_agent").provider_id == signed_in_claude.id
    assert load_assignment("ai_summarizer") is None


def test_quick_fallback_serves_quick_features(signed_in_claude, api_provider):
    save_default({
        "provider_id": signed_in_claude.id, "model": "sonnet",
        "quick_fallback": {"provider_id": api_provider.id, "model": "local"},
    })

    assignment = load_assignment("initial_diagram_bootstrap")

    assert (assignment.provider_id, assignment.model, assignment.mode) == (
        api_provider.id, "local", "api")


def test_offline_quick_fallback_resolves_to_offline(signed_in_claude):
    save_default({
        "provider_id": signed_in_claude.id, "model": "sonnet",
        "quick_fallback": {"offline": True},
    })

    assert load_assignment("ai_summarizer").mode == "offline"


def test_agent_fallback_serves_agentic_features_when_default_is_api_only(
    api_provider, signed_in_claude
):
    save_default({
        "provider_id": api_provider.id, "model": "local",
        "agent_fallback": {"provider_id": signed_in_claude.id, "model": "sonnet"},
    })

    assignment = load_assignment("wiki_general_agent")

    assert (assignment.provider_id, assignment.mode) == (signed_in_claude.id, "cli")


def test_api_only_default_without_agent_fallback_leaves_agentic_on_legacy(api_provider):
    save_default({"provider_id": api_provider.id, "model": "local"})

    assert load_assignment("c1_agent") is None


def test_blocking_call_sites_counts_the_default_and_its_fallbacks(
    anthropic_provider, signed_in_claude, api_provider
):
    save_default({
        "provider_id": signed_in_claude.id, "model": "m",
        "quick_fallback": {"provider_id": api_provider.id, "model": "x"},
    })

    assert "default" in blocking_call_sites(signed_in_claude.id)
    assert "default" in blocking_call_sites(api_provider.id)
    assert blocking_call_sites(anthropic_provider.id) == []


def test_anthropic_api_provider_is_allowed_for_an_agentic_group(anthropic_provider):
    problems = validate_group(
        {"group_id": "diagrams", "provider_id": anthropic_provider.id, "model": "m"}
    )

    assert problems == []


def test_features_cover_every_group_and_simple_call_site_exactly_once():
    covered = [member for feature in FEATURES.values() for member in feature.members]

    assert sorted(covered) == sorted(CALL_SITES)
    assert {f.id for f in FEATURES.values() if f.id in GROUPS} == set(GROUPS)
