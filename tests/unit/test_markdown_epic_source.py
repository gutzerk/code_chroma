"""MarkdownRequirementsSource: laziness, exclusion/citation rules, and malformed-item degrade."""

from __future__ import annotations

from pathlib import Path

from codechroma.requirements.markdown import frontmatter as frontmatter_module
from codechroma.requirements.markdown.epic_source import MarkdownRequirementsSource
from codechroma.requirements.models import ItemLink

FIXTURE_ROOT = Path(__file__).parent.parent / "fixtures" / "requirements_repo"


def test_list_items_opens_no_bodies(monkeypatch):
    def _boom(*_args, **_kwargs):
        raise AssertionError("list_items() must never parse a body")

    monkeypatch.setattr(frontmatter_module, "parse_criteria", _boom)
    source = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)
    items = source.list_items()

    assert {item.id for item in items} == {
        "EP-A-01",
        "EP-A-01-01",
        "EP-A-01-02",
        "EP-A-02",
        "EP-A-02-01",
    }


def test_illustrative_block_excluded():
    source = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)
    item = source.fetch_item("EP-A-01-02")

    assert len(item.requirements) == 1


def test_trailing_citation_lands_in_source_ref_not_text():
    source = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)
    item = source.fetch_item("EP-A-01-02")
    requirement = item.requirements[0]

    assert requirement.source_ref == "docs/logging.md §2"
    assert "docs/logging.md" not in requirement.text


def test_criteria_free_item_yields_empty_list_not_error():
    source = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)
    item = source.fetch_item("EP-A-02-01")

    assert item.requirements == ()


def test_depends_on_and_enables_become_item_links():
    source = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)
    item = source.fetch_item("EP-A-02")

    assert item.links == (
        ItemLink(id="EP-A-01", relation="depends_on", title="the foundation epic"),
        ItemLink(id="EP-Z-99", relation="enables", title="a future reporting epic"),
    )


def test_fetch_item_unknown_id_returns_none():
    source = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)
    item = source.fetch_item("NOPE")

    assert item is None


def test_fetch_item_matches_id_case_insensitively():
    source = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)
    item = source.fetch_item("ep-a-01")

    assert item is not None
    assert item.id == "EP-A-01"
    assert item.title == "Foundation: shared platform primitives"


def test_malformed_item_degrades_to_title_and_status(tmp_path):
    items_root = tmp_path / "epics"
    items_root.mkdir()
    (items_root / "broken.md").write_bytes(
        b"---\nid: EP-BROKEN\ntitle: Broken item\nstatus: Draft\nkind: epic\n---\n"
        b"## Acceptance Criteria\n\n- [x] a line with invalid utf-8: \xff\xfe\n"
    )
    source = MarkdownRequirementsSource(items_root, tmp_path)

    item = source.fetch_item("EP-BROKEN")

    assert item.title == "Broken item"
    assert item.status == "Draft"
    assert item.requirements == ()


def test_references_context_and_component_surface_on_fetch(tmp_path):
    items_root = tmp_path / "epics"
    items_root.mkdir()
    (items_root / "a.md").write_text(
        "---\n"
        "id: EP-REF\n"
        "title: Referencing epic\n"
        "status: Planned\n"
        "kind: epic\n"
        "references:\n"
        "  - plan/epics/LMP-78-infrastructure.md\n"
        '  - "LMP-101"\n'
        "context_file: context/work/epic-context/EP-REF.md\n"
        'component: "application"\n'
        "---\n"
    )
    source = MarkdownRequirementsSource(items_root, tmp_path)

    item = source.fetch_item("EP-REF")

    assert item.references == (
        "plan/epics/LMP-78-infrastructure.md",
        "LMP-101",
    )
    assert item.context_file == "context/work/epic-context/EP-REF.md"
    assert item.component == "application"


def test_missing_reference_fields_default_to_empty(tmp_path):
    items_root = tmp_path / "epics"
    items_root.mkdir()
    (items_root / "a.md").write_text(
        "---\nid: EP-PLAIN\ntitle: Plain\nstatus: Draft\nkind: epic\n---\n"
    )
    source = MarkdownRequirementsSource(items_root, tmp_path)

    item = source.fetch_item("EP-PLAIN")

    assert item.references == ()
    assert item.context_file is None
    assert item.component is None


def test_duplicate_id_keeps_the_first(tmp_path):
    items_root = tmp_path / "epics"
    items_root.mkdir()
    (items_root / "a-first.md").write_text(
        "---\nid: EP-DUP\ntitle: First\nstatus: Draft\nkind: epic\n---\n"
    )
    (items_root / "b-second.md").write_text(
        "---\nid: EP-DUP\ntitle: Second\nstatus: Draft\nkind: epic\n---\n"
    )
    source = MarkdownRequirementsSource(items_root, tmp_path)

    items = source.list_items()

    assert [item.title for item in items if item.id == "EP-DUP"] == ["First"]


def test_fingerprint_changes_when_a_listed_item_changes(tmp_path):
    items_root = tmp_path / "epics"
    items_root.mkdir()
    path = items_root / "a.md"
    path.write_text("---\nid: EP-X\ntitle: X\nstatus: Draft\nkind: epic\n---\n")
    source = MarkdownRequirementsSource(items_root, tmp_path)
    before = source.fingerprint()

    path.write_text("---\nid: EP-X\ntitle: X renamed\nstatus: Draft\nkind: epic\n---\n")
    after = source.fingerprint()

    assert before != after


def test_fingerprint_stable_when_nothing_changed():
    source = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)
    first = source.fingerprint()

    second = source.fingerprint()

    assert first == second
