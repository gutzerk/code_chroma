"""ensure_seeded: the one place "a canvas always has a root block" is enforced, and its refusals."""

import json
from pathlib import Path

from codechroma.canvas.document import HIERARCHY_SEED_ID, CanvasCore, ensure_seeded


def _seed_ids(path: Path) -> list[str]:
    return list(json.loads(path.read_text(encoding="utf-8"))["elements"])


def test_seeds_a_missing_file_with_just_the_root_block(tmp_path):
    core, diagrams = tmp_path / "canvas-core.json", tmp_path / "diagrams"

    wrote = ensure_seeded(core, diagrams, "root")

    assert wrote and _seed_ids(core) == [HIERARCHY_SEED_ID]


def test_seeding_the_same_document_twice_is_idempotent(tmp_path):
    core, diagrams = tmp_path / "canvas-core.json", tmp_path / "diagrams"
    ensure_seeded(core, diagrams, "root")

    wrote = ensure_seeded(core, diagrams, "root")

    assert not wrote and _seed_ids(core) == [HIERARCHY_SEED_ID]


def test_a_valid_but_empty_object_is_seeded_not_mistaken_for_a_parse_failure(tmp_path):
    """`{}` reads as falsy exactly like a broken file, which used to leave such a canvas blank."""
    core, diagrams = tmp_path / "canvas-core.json", tmp_path / "diagrams"
    core.write_text("{}", encoding="utf-8")

    wrote = ensure_seeded(core, diagrams, "root")

    assert wrote and _seed_ids(core) == [HIERARCHY_SEED_ID]


def test_a_document_with_elements_is_left_alone(tmp_path):
    core, diagrams = tmp_path / "canvas-core.json", tmp_path / "diagrams"
    CanvasCore.model_validate({"elements": {"kept": {"id": "kept"}}}).save(core)

    wrote = ensure_seeded(core, diagrams, "root")

    assert not wrote and _seed_ids(core) == ["kept"]


def test_unparseable_json_is_left_alone_rather_than_clobbered(tmp_path):
    core, diagrams = tmp_path / "canvas-core.json", tmp_path / "diagrams"
    core.write_text("not json at all", encoding="utf-8")

    wrote = ensure_seeded(core, diagrams, "root")

    assert not wrote and core.read_text(encoding="utf-8") == "not json at all"


def test_a_shape_canvascore_rejects_returns_false_instead_of_raising(tmp_path):
    """🔴 It raised ValidationError, crashing Workspace creation and prs.reconcile() outright."""
    core, diagrams = tmp_path / "canvas-core.json", tmp_path / "diagrams"
    core.write_text(json.dumps({"elements": {"a": {"id": "a", "render": 12345}}}), encoding="utf-8")

    wrote = ensure_seeded(core, diagrams, "root")

    assert (
        not wrote
        and json.loads(core.read_text(encoding="utf-8"))["elements"]["a"]["render"] == 12345
    )


def test_a_non_object_document_is_left_alone(tmp_path):
    core, diagrams = tmp_path / "canvas-core.json", tmp_path / "diagrams"
    core.write_text("[1, 2, 3]", encoding="utf-8")

    wrote = ensure_seeded(core, diagrams, "root")

    assert not wrote and core.read_text(encoding="utf-8") == "[1, 2, 3]"


def test_reports_false_when_the_write_could_not_land(tmp_path, monkeypatch):
    """write_json swallows its own OSError, so the file landing is the only proof of a seed."""
    monkeypatch.setattr("codechroma.canvas.document.write_json", lambda path, payload: None)
    core, diagrams = tmp_path / "canvas-core.json", tmp_path / "diagrams"

    wrote = ensure_seeded(core, diagrams, "root")

    assert not wrote
