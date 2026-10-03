"""The cross-project diagram-type library: id validation, save/load/list/delete, env override."""

import pytest

from codechroma.diagrams import library


@pytest.fixture(autouse=True)
def isolated_library(tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


def _definition(type_id: str = "data-flow") -> dict:
    return {
        "id": type_id,
        "title": "Data flow",
        "description": "How data moves from the edge to storage",
        "style": "boxes-arrows",
        "layout": {"direction": "LR"},
        "grouping": {"enabled": False, "label": ""},
        "relation_kinds": [{"id": "writes", "label": "writes to"}],
        "instructions": "One box per component that owns or moves data.",
    }


def test_library_dir_honors_env_override(tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "custom-types"))

    assert library.library_dir() == tmp_path / "custom-types"


def test_library_dir_defaults_to_home(monkeypatch):
    monkeypatch.delenv(library.DIAGRAM_TYPES_DIR_ENV, raising=False)

    from pathlib import Path

    assert library.library_dir() == Path.home() / ".codechroma" / "diagram-types"


@pytest.mark.parametrize(
    "type_id,expected",
    [
        ("data-flow", True),
        ("a", True),
        ("A-B", False),
        ("../etc", False),
        ("/etc/passwd", False),
        ("-leading-dash", False),
        ("has space", False),
        ("x" * 65, False),
        ("data-flow\n", False),
    ],
)
def test_valid_type_id(type_id, expected):
    assert library.valid_type_id(type_id) is expected


def test_save_then_load_round_trips():
    saved = library.save_type(_definition())

    assert library.load_type("data-flow")["title"] == "Data flow"
    assert saved["created_at"] == saved["updated_at"]


def test_save_twice_keeps_original_created_at():
    first = library.save_type(_definition())
    second = library.save_type({**_definition(), "title": "Data flow v2"})

    assert second["created_at"] == first["created_at"]
    assert second["updated_at"] != first["created_at"] or second["title"] == "Data flow v2"


def test_list_types_returns_summary_only():
    library.save_type(_definition())

    [summary] = library.list_types()
    assert summary == {
        "id": "data-flow",
        "title": "Data flow",
        "description": "How data moves from the edge to storage",
        "style": "boxes-arrows",
    }


def test_list_types_empty_when_dir_missing():
    assert library.list_types() == []


def test_delete_type_removes_it():
    library.save_type(_definition())

    assert library.delete_type("data-flow") is True
    assert library.load_type("data-flow") is None


def test_validate_definition_accepts_the_fully_shaped_fixture():
    assert library.validate_definition(_definition()) == []


def test_validate_definition_rejects_a_string_layout_instead_of_an_object():
    definition = {**_definition(), "layout": "horizontal"}

    problems = library.validate_definition(definition)

    assert any("layout" in problem for problem in problems)


def test_validate_definition_rejects_a_string_grouping_instead_of_an_object():
    definition = {**_definition(), "grouping": "none"}

    problems = library.validate_definition(definition)

    assert any("grouping" in problem for problem in problems)


def test_validate_definition_rejects_bare_string_relation_kinds():
    definition = {**_definition(), "relation_kinds": ["request", "response"]}

    problems = library.validate_definition(definition)

    assert any("relation_kinds" in problem for problem in problems)


def test_validate_definition_accepts_empty_relation_kinds():
    definition = {**_definition(), "relation_kinds": []}

    assert library.validate_definition(definition) == []


def test_delete_type_missing_returns_false():
    assert library.delete_type("nope") is False


def test_delete_type_rejects_invalid_id():
    assert library.delete_type("../etc") is False


def test_load_type_malformed_file_returns_none(tmp_path):
    path = library.type_path("broken")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("not json")

    assert library.load_type("broken") is None


@pytest.mark.parametrize(
    "definition,match",
    [
        (_definition("../etc"), "id"),
        ({**_definition(), "instructions": ""}, "instructions"),
        ({**_definition(), "style": "not-a-style"}, "style"),
    ],
)
def test_save_type_rejects_invalid_definition(definition, match):
    with pytest.raises(ValueError, match=match):
        library.save_type(definition)


def test_validate_definition_accepts_an_inline_style_dict():
    definition = {**_definition(), "style": {"supports_groups": True}}

    assert library.validate_definition(definition) == []


def test_validate_definition_defaults_new_fields_when_absent():
    assert library.validate_definition(_definition()) == []


def test_validate_definition_rejects_a_non_list_overlays():
    definition = {**_definition(), "overlays": "changes"}

    problems = library.validate_definition(definition)

    assert any("overlays" in problem for problem in problems)


def test_validate_definition_rejects_an_unknown_overlay_when_known_set_given():
    definition = {**_definition(), "overlays": ["changes"]}

    problems = library.validate_definition(definition, known_overlay_providers={"plan"})

    assert any("overlays" in problem for problem in problems)


def test_validate_definition_accepts_a_known_overlay():
    definition = {**_definition(), "overlays": ["changes"]}

    problems = library.validate_definition(definition, known_overlay_providers={"changes"})

    assert problems == []


def test_validate_definition_rejects_an_unknown_context_provider():
    definition = {**_definition(), "context": "bogus"}

    problems = library.validate_definition(definition, known_context_providers={"patterns"})

    assert any("context" in problem for problem in problems)


def test_validate_definition_accepts_a_null_context():
    definition = {**_definition(), "context": None}

    assert library.validate_definition(definition, known_context_providers={"patterns"}) == []


def test_validate_definition_rejects_a_bad_checks_shape():
    definition = {**_definition(), "checks": {"shape": "nested"}}

    problems = library.validate_definition(definition)

    assert any("checks" in problem for problem in problems)


def test_validate_definition_rejects_a_review_with_unknown_axis():
    definition = {**_definition(), "review": {"axis": "vibes", "agent_factory": "x"}}

    problems = library.validate_definition(definition)

    assert any("review" in problem for problem in problems)


def test_validate_definition_accepts_a_null_review():
    definition = {**_definition(), "review": None}

    assert library.validate_definition(definition) == []


def test_save_type_enforces_max_types(monkeypatch):
    import types

    fake_settings = types.SimpleNamespace(
        custom_diagrams=types.SimpleNamespace(
            max_types=1, type_id_pattern=library.settings.custom_diagrams.type_id_pattern
        )
    )
    monkeypatch.setattr(library, "settings", fake_settings)
    library.save_type(_definition("one"))

    with pytest.raises(ValueError, match="already holds"):
        library.save_type(_definition("two"))
