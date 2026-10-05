"""Unit coverage for diagram_seed: copying main's diagram files into a new agent worktree."""

from codechroma.bridge.diagram_seed import seed_diagrams_from_main
from tests.conftest import diagram_json_path


def test_seed_copies_every_diagrams_artifact_file(tmp_path):
    """Layout files are no longer seeded (016 Stage 6) -- position now lives on canvas.json."""
    main = tmp_path / "main"
    target = tmp_path / "target"
    diagram_json_path(main, "c1").parent.mkdir(parents=True)
    diagram_json_path(main, "c1").write_text('{"blocks": []}', encoding="utf-8")
    (main / ".codechroma" / "c1-layout.json").write_text("{}", encoding="utf-8")
    diagram_json_path(main, "patterns").parent.mkdir(parents=True)
    diagram_json_path(main, "patterns").write_text('{"nodes": []}', encoding="utf-8")
    (main / ".codechroma" / "patterns-layout.json").write_text("{}", encoding="utf-8")

    seed_diagrams_from_main(main, target)

    assert diagram_json_path(target, "c1").read_text(encoding="utf-8") == '{"blocks": []}'
    assert not (target / ".codechroma" / "c1-layout.json").exists()
    assert diagram_json_path(target, "patterns").read_text(encoding="utf-8") == '{"nodes": []}'
    assert not (target / ".codechroma" / "patterns-layout.json").exists()


def test_seed_is_a_no_op_when_main_has_no_diagrams_yet(tmp_path):
    main = tmp_path / "main"
    target = tmp_path / "target"

    seed_diagrams_from_main(main, target)

    assert not (target / ".codechroma").exists()


def test_seed_never_overwrites_a_diagram_the_target_already_has(tmp_path):
    main = tmp_path / "main"
    target = tmp_path / "target"
    diagram_json_path(main, "patterns").parent.mkdir(parents=True)
    diagram_json_path(main, "patterns").write_text('{"nodes": ["main"]}', encoding="utf-8")
    diagram_json_path(target, "patterns").parent.mkdir(parents=True)
    diagram_json_path(target, "patterns").write_text('{"nodes": ["own"]}', encoding="utf-8")

    seed_diagrams_from_main(main, target)

    assert diagram_json_path(target, "patterns").read_text(encoding="utf-8") == '{"nodes": ["own"]}'
