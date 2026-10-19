import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PALETTE = {
    "bg": "#11131a",
    "accent": "#6c8cff",
    "text": "#e6e9f0",
    "muted": "#8b93a7",
    "line": "#2a3040",
}
APP = (ROOT / "dotnet/CodeChroma.Shell.App/App.axaml").read_text("utf-8")


@pytest.mark.parametrize(
    ("css_name", "axaml_attribute"),
    [
        ("bg", "RegionColor"),
        ("accent", "Accent"),
        ("text", "BaseHigh"),
        ("muted", "BaseMedium"),
        ("line", "ChromeLow"),
    ],
)
def test_the_shell_palette_matches_the_original_launcher(css_name, axaml_attribute):
    declared = re.search(rf'{axaml_attribute}="(#[0-9a-fA-F]{{6}})"', APP)

    assert declared is not None and declared.group(1).lower() == PALETTE[css_name]


def test_the_shell_uses_the_dark_theme_variant():
    assert 'RequestedThemeVariant="Dark"' in APP
