"""The render-style registry: every entry is well-formed, and the web mirror lists the same ids."""

import re
from pathlib import Path

from codechroma.diagrams.styles import STYLES, resolve_style_overrides

_WEB_ROOT = Path(__file__).resolve().parents[2] / "web" / "src" / "canvas" / "custom"
_WEB_REGISTRY = _WEB_ROOT / "styles" / "registry.ts"


def test_every_style_has_a_non_empty_description():
    for style in STYLES.values():
        assert style.description.strip()


def test_every_style_id_matches_its_dict_key():
    for key, style in STYLES.items():
        assert key == style.id


def test_at_least_boxes_arrows_is_registered():
    assert "boxes-arrows" in STYLES


def test_dependency_graph_is_registered_and_supports_groups():
    assert "dependency-graph" in STYLES
    assert STYLES["dependency-graph"].overrides["supports_groups"] is True


def test_dependency_graph_allows_self_relations():
    assert STYLES["dependency-graph"].overrides["allow_self_relations"] is True


def test_web_registry_lists_the_same_style_ids():
    if not _WEB_REGISTRY.exists():
        return
    text = _WEB_REGISTRY.read_text()
    web_ids = set(re.findall(r"id\s*:\s*['\"]([a-z0-9-]+)['\"]", text))
    assert set(STYLES) <= web_ids


def test_every_036_preset_is_registered():
    for style_id in (
        "patterns-yellow-arrows", "impact-status-colors", "layered-flow", "state-machine",
    ):
        assert style_id in STYLES


def test_resolve_style_overrides_by_name():
    assert resolve_style_overrides("dependency-graph") == {
        "supports_groups": True, "allow_self_relations": True,
    }


def test_resolve_style_overrides_inline_dict_is_used_as_is():
    assert resolve_style_overrides({"edge_style": {"color": "red"}}) == {
        "edge_style": {"color": "red"},
    }


def test_resolve_style_overrides_unknown_name_degrades_to_empty():
    assert resolve_style_overrides("not-a-real-style") == {}


def test_resolve_style_overrides_none_is_empty():
    assert resolve_style_overrides(None) == {}
