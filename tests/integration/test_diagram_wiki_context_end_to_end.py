"""Integration: a real bridge over a fixture repo, proving the wiki-context route earns its keep --
smaller context than a full dump (US1), an undocumented file still gets a real page, never a false
gap (US3), staleness reuse (US5)."""

import json

from fastapi.testclient import TestClient

from tests.conftest import diagram_json_path

_STRATEGY_SOURCE = b"""
from abc import ABC, abstractmethod


class DiscountStrategy(ABC):
    @abstractmethod
    def apply(self, price):
        ...


class PercentDiscount(DiscountStrategy):
    def apply(self, price):
        return price * 0.9


class FlatDiscount(DiscountStrategy):
    def apply(self, price):
        return price - 5
"""

_UNDOCUMENTED_SOURCE = b"""
def helper(value):
    return value * 2
"""


def test_wiki_backed_context_is_smaller_than_a_full_context_dump(bridge):
    with TestClient(bridge.app) as client:
        ws = bridge.registry.get("default")
        ws.engine.sync_wiki(bridge.repo / ".codechroma" / "wiki")

        full_structure = client.get("/repos/default/structure?depth=5").content
        full_patterns_context = client.get("/repos/default/patterns/context").content
        wiki_context = client.get(
            "/repos/default/wiki-context?paths=billing,billing/models,billing/service.py"
        ).content

    assert len(wiki_context) < len(full_structure)
    assert len(wiki_context) < len(full_patterns_context)


def test_a_new_undocumented_file_still_gets_a_real_page_not_a_gap(bridge):
    """gaps.json tracks undocumented symbols, not missing pages -- sync_wiki() writes one anyway."""
    new_file = bridge.repo / "billing" / "helpers.py"

    with TestClient(bridge.app) as client:
        ws = bridge.registry.get("default")
        ws.engine.sync_wiki(bridge.repo / ".codechroma" / "wiki")
        new_file.write_bytes(_UNDOCUMENTED_SOURCE)
        ws.engine.reanalyze(["billing/helpers.py"])

        wiki_payload = client.get("/repos/default/wiki-context?paths=billing/helpers.py").json()

    assert "billing/helpers.py" not in wiki_payload["gaps"]
    assert any(p["path"] == "billing/helpers.py" for p in wiki_payload["pages"])


def test_editing_a_wiki_backed_file_flips_the_existing_patterns_staleness_flag(bridge):
    (bridge.repo / "discounts.py").write_bytes(_STRATEGY_SOURCE)

    with TestClient(bridge.app) as client:
        ws = bridge.registry.get("default")
        ws.engine.reanalyze(["discounts.py"])
        ws.engine.sync_wiki(bridge.repo / ".codechroma" / "wiki")
        client.get("/repos/default/wiki-context?paths=discounts.py")
        reviewed = client.get("/repos/default/patterns").json()["fingerprint"]
        patterns_file = diagram_json_path(bridge.repo, "patterns")
        patterns_file.write_text(
            json.dumps({"fingerprint": reviewed, "nodes": [], "relations": []})
, encoding="utf-8")

        (bridge.repo / "discounts.py").write_text(
            _STRATEGY_SOURCE.decode()
            + "\n\nclass PremiumDiscount(DiscountStrategy):\n    def apply(self, price):\n"
            "        return price - 20\n"
, encoding="utf-8")
        ws.engine.reanalyze(["discounts.py"])
        ws.engine.sync_wiki(bridge.repo / ".codechroma" / "wiki")
        payload = client.get("/repos/default/patterns").json()

    assert payload["stale"] is True
