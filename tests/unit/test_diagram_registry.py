"""Pins DIAGRAMS to per-app runner factories -- BridgeServices owns the instances, not a module."""

from __future__ import annotations

from pathlib import Path

import pytest

from codechroma.bridge.diagram_registry import DIAGRAMS, DiagramRegistry
from codechroma.bridge.services import _build_skill_agents
from codechroma.diagrams import library


@pytest.fixture(autouse=True)
def _isolated_library(tmp_path, monkeypatch):
    """Every test gets its own throwaway library dir -- never the real ~/.codechroma library."""
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


def _definition(type_id: str = "data-flow") -> dict:
    return {
        "id": type_id,
        "title": "Data flow",
        "style": "boxes-arrows",
        "layout": {"direction": "LR"},
        "grouping": {"enabled": False, "label": ""},
        "relation_kinds": [{"id": "writes", "label": "writes to"}],
        "instructions": "One box per component that owns or moves data.",
    }


def test_every_spec_builds_an_independent_runner_per_call():
    first = DIAGRAMS["c1"].agent_factory()
    second = DIAGRAMS["c1"].agent_factory()

    assert first is not second


def test_services_build_one_runner_per_skill_run_kind():
    agents = _build_skill_agents()

    assert set(agents) == {
        "c1",
        "patterns",
        "impact",
        "impact-changes",
        "research",
        "epic-brief",
        "wiki-general",
        "wiki-general-update",
    }


def test_builtin_kinds_are_not_iterated_as_custom_definitions():
    # `get` synthesizes a custom spec only when a library definition exists; a missing type is None.
    assert DIAGRAMS.get("does-not-exist") is None
    assert DIAGRAMS.get("does-not-exist", "fallback") == "fallback"


def test_get_synthesizes_a_spec_from_a_library_definition():
    library.save_type(_definition("data-flow"))
    reg = DiagramRegistry({})

    spec = reg.get("custom/data-flow")

    assert spec is not None
    assert spec.kind == "custom/data-flow"
    assert spec.has_bootstrap is False


def test_custom_dir_is_the_registry_owned_custom_directory():
    assert (
        DiagramRegistry.custom_dir(Path("/r")) == Path("/r") / ".codechroma" / "diagrams" / "custom"
    )


def test_a_custom_types_artifact_lands_under_its_own_diagram_directory():
    library.save_type(_definition("data-flow"))
    reg = DiagramRegistry({})

    spec = reg.get("custom/data-flow")

    assert spec.artifact_path(Path("/tmp/some-repo")) == (
        Path("/tmp/some-repo")
        / ".codechroma"
        / "diagrams"
        / "custom"
        / "data-flow"
        / "data-flow.json"
    )


def test_iteration_stays_on_builtins_no_matter_what_the_library_holds():
    # A saved custom type must never leak into the build-time iteration (bootstrap/seed/watchers).
    library.save_type(_definition("data-flow"))

    assert set(DIAGRAMS.keys()) == {"c1", "patterns", "impact"}


@pytest.mark.parametrize("kind", ["no-such-kind", "feature-plan/../../etc"])
def test_getitem_misses_on_an_unknown_or_unsafe_kind(kind):
    with pytest.raises(KeyError):
        DIAGRAMS[kind]


# --- feature-plan/<slug>: 055-diagram-feature-plan ---


def test_feature_plan_dir_is_the_registry_owned_feature_plans_directory():
    expected = Path("/r") / ".codechroma" / "diagrams" / "feature-plan"

    assert DiagramRegistry.feature_plan_dir(Path("/r")) == expected


def test_get_synthesizes_a_feature_plan_spec_for_any_slug_with_no_saved_definition():
    reg = DiagramRegistry({})

    spec = reg.get("feature-plan/token-auth")

    assert spec is not None
    assert spec.kind == "feature-plan/token-auth"
    assert spec.has_bootstrap is False
    assert spec.has_generate is False


def test_a_feature_plans_artifact_lands_under_its_own_diagram_directory():
    reg = DiagramRegistry({})

    spec = reg.get("feature-plan/token-auth")

    assert spec.artifact_path(Path("/tmp/some-repo")) == (
        Path("/tmp/some-repo")
        / ".codechroma"
        / "diagrams"
        / "feature-plan"
        / "token-auth"
        / "token-auth.json"
    )


def test_feature_plan_rejects_a_slug_that_would_escape_its_directory():
    reg = DiagramRegistry({})

    assert reg.get("feature-plan/../../etc") is None


def test_feature_plan_kinds_stay_out_of_the_build_time_iteration():
    # Same guarantee as custom's own test above: a synthesized spec never leaks into the iteration.
    assert DIAGRAMS.get("feature-plan/token-auth") is not None
    assert set(DIAGRAMS.keys()) == {"c1", "patterns", "impact"}


def test_getitem_misses_on_an_unsafe_feature_plan_slug():
    with pytest.raises(KeyError):
        DIAGRAMS["feature-plan/../../etc"]
