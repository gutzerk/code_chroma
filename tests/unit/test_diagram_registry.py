"""Pins DIAGRAMS to per-app runner factories -- BridgeServices owns the instances, not a module."""

from __future__ import annotations

from pathlib import Path

import pytest

from codechroma.bridge.diagram_registry import DIAGRAMS, DiagramRegistry
from codechroma.bridge.services import _build_skill_agents
from codechroma.diagrams import library

pytestmark = pytest.mark.usefixtures("isolated_library")


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
        "epics",
        "impact-changes",
        "epic-brief",
        "wiki-general",
        "wiki-general-update",
        "sequence",
    }


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

    assert set(DIAGRAMS.keys()) == {"c1", "epics", "patterns", "impact", "sequence"}


@pytest.mark.parametrize("kind", ["no-such-kind", "feature-plan/../../etc"])
def test_getitem_misses_on_an_unknown_or_unsafe_kind(kind):
    with pytest.raises(KeyError):
        DIAGRAMS[kind]


# --- feature-plan/<slug> and epics/<epic_id>: registry-synthesized per-item diagram kinds ---

_ITEM_KINDS = pytest.mark.parametrize(
    ("prefix", "item"),
    [("feature-plan", "token-auth"), ("epics", "EP-4")],
    ids=["feature-plan", "epics"],
)


@pytest.mark.parametrize(
    ("prefix", "dir_of"),
    [("feature-plan", DiagramRegistry.feature_plan_dir), ("epics", DiagramRegistry.epics_dir)],
)
def test_item_dir_is_the_registry_owned_directory(prefix, dir_of):
    expected = Path("/r") / ".codechroma" / "diagrams" / prefix

    assert dir_of(Path("/r")) == expected


@_ITEM_KINDS
def test_get_synthesizes_a_spec_for_any_item_with_no_saved_definition(prefix, item):
    reg = DiagramRegistry({})

    spec = reg.get(f"{prefix}/{item}")

    assert spec is not None
    assert spec.kind == f"{prefix}/{item}"
    assert spec.has_bootstrap is False
    assert spec.has_generate is False


@_ITEM_KINDS
def test_an_items_artifact_lands_under_its_own_diagram_directory(prefix, item):
    reg = DiagramRegistry({})

    spec = reg.get(f"{prefix}/{item}")

    assert spec.artifact_path(Path("/tmp/some-repo")) == (
        Path("/tmp/some-repo") / ".codechroma" / "diagrams" / prefix / item / f"{item}.json"
    )


@_ITEM_KINDS
def test_item_rejects_an_id_that_would_escape_its_directory(prefix, item):
    reg = DiagramRegistry({})

    assert reg.get(f"{prefix}/../../etc") is None
