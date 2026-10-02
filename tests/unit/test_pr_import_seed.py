"""pr_import_seed: copying main's authored diagrams into a bare PR worktree, safely."""

import json
from pathlib import Path

from codechroma.bridge import pr_import_seed
from codechroma.bridge.pr_import_seed import seed_diagrams_from_main
from codechroma.config import RequirementsConfig, Settings


def _write(root: Path, relative: str, content: str = "{}") -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


def _main_root(tmp_path: Path) -> Path:
    """A main root with every diagram main could have authored."""
    main = tmp_path / "main"
    _write(main, ".codechroma/diagrams/c1/c1.json", '{"system": {}}')
    _write(main, ".codechroma/diagrams/patterns/patterns.json", '{"patterns": []}')
    _write(main, ".codechroma/diagrams/impact/impact.json", '{"nodes": []}')
    _write(main, ".codechroma/diagrams/custom/data-flow/data-flow.json", '{"nodes": []}')
    _write(main, ".codechroma/c1-layout.json", '{"box": {"x": 1}}')
    _write(main, ".codechroma/canvas-core.json", '{"elements": {"root": {}}}')
    _write(main, "plan/epics/roadmap.md", "---\nid: root\n---\nEpic\n")
    return main


def test_seed_copies_every_authored_diagram_into_a_bare_pr_worktree(tmp_path):
    main = _main_root(tmp_path)
    pr = tmp_path / "pr"
    pr.mkdir()

    seed_diagrams_from_main(pr, main)

    assert (pr / ".codechroma/diagrams/c1/c1.json").exists()
    assert (pr / ".codechroma/diagrams/patterns/patterns.json").exists()
    assert (pr / ".codechroma/diagrams/impact/impact.json").exists()
    assert (pr / ".codechroma/diagrams/custom/data-flow/data-flow.json").exists()
    assert (pr / "plan/epics/roadmap.md").exists()


def test_seed_copies_canvas_doc_so_a_read_only_pr_can_show_its_hierarchy_box(tmp_path):
    """A read-only PR can never self-seed canvas-core's hierarchy element (refuse_if_read_only)."""
    main = _main_root(tmp_path)
    pr = tmp_path / "pr"
    pr.mkdir()

    seed_diagrams_from_main(pr, main)

    assert (pr / ".codechroma/canvas-core.json").read_text() == '{"elements": {"root": {}}}'


def test_seed_does_not_overwrite_a_pr_canvas_doc_that_already_exists(tmp_path):
    main = _main_root(tmp_path)
    pr = tmp_path / "pr"
    _write(pr, ".codechroma/canvas-core.json", "PR-VERSION")

    seed_diagrams_from_main(pr, main)

    assert (pr / ".codechroma/canvas-core.json").read_text() == "PR-VERSION"


def test_seed_does_not_copy_dead_layout_files(tmp_path):
    """016 Stage 6 retired every diagram-kind layout route; nothing will ever read one again."""
    main = _main_root(tmp_path)
    pr = tmp_path / "pr"
    pr.mkdir()

    seed_diagrams_from_main(pr, main)

    assert not (pr / ".codechroma/c1-layout.json").exists()


def test_seed_leaves_main_untouched(tmp_path):
    main = _main_root(tmp_path)
    pr = tmp_path / "pr"
    pr.mkdir()

    seed_diagrams_from_main(pr, main)

    assert (main / ".codechroma/diagrams/patterns/patterns.json").exists()
    assert not (pr / ".codechroma") == (main / ".codechroma")


def test_seed_does_not_overwrite_a_pr_artifact_that_already_exists(tmp_path):
    main = _main_root(tmp_path)
    pr = tmp_path / "pr"
    _write(pr, ".codechroma/diagrams/patterns/patterns.json", "PR-VERSION")

    seed_diagrams_from_main(pr, main)

    assert (pr / ".codechroma/diagrams/patterns/patterns.json").read_text() == "PR-VERSION"


def test_seed_writes_only_the_canvas_when_main_has_no_diagrams(tmp_path):
    """The canvas is the one thing seeded unconditionally -- a PR without it renders nothing."""
    main = tmp_path / "main"
    main.mkdir()
    pr = tmp_path / "pr"
    pr.mkdir()

    seed_diagrams_from_main(pr, main)

    assert [p.name for p in (pr / ".codechroma").iterdir()] == ["canvas-core.json"]


def test_seed_is_a_no_op_when_pr_is_main(tmp_path):
    main = _main_root(tmp_path)

    seed_diagrams_from_main(main, main)

    assert (main / ".codechroma/diagrams/patterns/patterns.json").exists()


def test_seed_skips_an_external_requirements_source(tmp_path, monkeypatch):
    """A source uri pointing outside main (an absolute path) is never copied in."""
    main = tmp_path / "main"
    _write(main, ".codechroma/diagrams/patterns/patterns.json", "{}")
    external = tmp_path / "external-epics"
    external.mkdir()
    monkeypatch.setattr(
        pr_import_seed,
        "settings",
        Settings(
            requirements=RequirementsConfig(
                requirements_source_uri=f"file://{external}", delivery_source_uri="file://specs"
            )
        ),
    )
    pr = tmp_path / "pr"
    pr.mkdir()

    seed_diagrams_from_main(pr, main)

    # The external source is left as-is (never copied, never written into).
    assert list(external.iterdir()) == []
    # Patterns still seeded from main.
    assert (pr / ".codechroma/diagrams/patterns/patterns.json").exists()


def test_seed_writes_a_root_block_when_main_has_no_canvas_of_its_own(tmp_path):
    main = tmp_path / "main"
    target = tmp_path / "target"
    (main / ".codechroma").mkdir(parents=True)

    seed_diagrams_from_main(target, main)

    saved = json.loads((target / ".codechroma" / "canvas-core.json").read_text())
    assert [e["render"] for e in saved["elements"].values()] == ["hierarchy"]


def test_seed_canvas_doc_alone_leaves_the_prs_own_requirements_source_untouched(
    tmp_path, monkeypatch
):
    """What prs.reconcile() calls every boot; the full seed would copytree main's source over it."""
    monkeypatch.setattr(
        pr_import_seed,
        "settings",
        Settings(requirements=RequirementsConfig(requirements_source_uri="plan/epics")),
    )
    main = _main_root(tmp_path)
    pr = tmp_path / "pr"
    _write(pr, "plan/epics/roadmap.md", "PR-VERSION")

    pr_import_seed.seed_canvas_doc(pr, main)

    assert (pr / "plan/epics/roadmap.md").read_text() == "PR-VERSION"


def test_seed_canvas_doc_is_a_no_op_when_the_pr_root_is_main(tmp_path):
    main = _main_root(tmp_path)

    pr_import_seed.seed_canvas_doc(main, main)

    assert (main / ".codechroma/canvas-core.json").read_text() == '{"elements": {"root": {}}}'
