"""Heading spelling variants and section-name synonyms all locate the criteria section (FR-029)."""

from __future__ import annotations

import pytest

from codechroma.requirements.markdown.frontmatter import find_section

_BODY_TEMPLATE = "{heading}\n\n- [x] one criterion\n"

_HEADING_SPELLINGS = [
    "## Acceptance Criteria",
    "## Acceptance Criteria (Given/When/Then)",
    "## Acceptance Criteria *(functional)*",
    "## 3. Acceptance Criteria",
    "## ACCEPTANCE CRITERIA",
    "## Acceptance Criteria:",
    "## Success Criteria",
    "## Key Deliverables",
]


@pytest.mark.parametrize("heading", _HEADING_SPELLINGS)
def test_heading_spellings_and_synonyms_locate_the_section(heading):
    body = _BODY_TEMPLATE.format(heading=heading)

    section = find_section(body)

    assert section == "- [x] one criterion"


def test_unrecognised_heading_is_not_located():
    body = "## Random Notes\n\n- [x] one criterion\n"

    section = find_section(body)

    assert section is None


def test_section_stops_at_next_heading_of_same_or_higher_level():
    body = "## Acceptance Criteria\n\n- [x] first\n\n## Notes\n\nSomething else entirely.\n"

    section = find_section(body)

    assert section == "- [x] first"
