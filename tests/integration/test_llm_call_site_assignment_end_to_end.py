"""Integration test: an unassigned call site behaves as today; an assigned one uses build_provider.

Covers spec FR-006/FR-007/FR-009 and quickstart.md steps 3-4 -- exercises the real
providers_store/call_site_settings/llm_provider/ai_summarizer wiring together, with a stubbed
LLMProvider standing in for the network call.
"""

import pytest

from codechroma.graph.models import AISummary, HierarchyLevel, HierarchyNode
from codechroma.llm.providers_store import create_provider
from codechroma.summarize.ai_summarizer import AISummarizer


class _StubProvider:
    def __init__(self):
        self.calls: list[dict] = []

    def complete(self, *, user, model, max_tokens, system=None):
        self.calls.append({"user": user, "model": model})
        return "stubbed summary"


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setenv("codechroma_LLM_PROVIDERS_FILE", str(tmp_path / "providers.json"))
    monkeypatch.setenv("codechroma_LLM_CALL_SITE_SETTINGS_FILE", str(tmp_path / "call-sites.json"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


def _node() -> HierarchyNode:
    return HierarchyNode(id="n1", name="Widget", level=HierarchyLevel.COMPONENT)


def test_unassigned_call_site_falls_back_to_offline_summary():
    summarizer = AISummarizer.from_env()

    assert not summarizer.available
    summary = summarizer.summarize(_node(), context="renders the widget")
    assert isinstance(summary, AISummary)
    assert "Widget" in summary.text


def test_assigned_call_site_resolves_through_build_provider(monkeypatch):
    provider = create_provider({
        "label": "Local", "kind": "api", "transport": "openai-compatible",
        "base_url": "http://localhost:11434/v1", "is_local": True,
    })
    from codechroma.llm.call_site_settings import save_assignment

    save_assignment("ai_summarizer", {
        "provider_id": provider.id, "model": "llama3", "mode": "api",
    })
    stub = _StubProvider()
    monkeypatch.setattr(
        "codechroma.summarize.ai_summarizer.build_provider", lambda assignment: stub
    )

    summarizer = AISummarizer.from_env()

    assert summarizer.available
    summary = summarizer.summarize(_node(), context="renders the widget")
    assert summary.text == "stubbed summary"
    assert stub.calls[0]["model"] == "llama3"


def test_assigned_call_site_never_touches_the_network_when_stubbed(monkeypatch):
    """No real HTTP call here -- the stub is the only thing summarize() can reach."""
    provider = create_provider({
        "label": "Local", "kind": "api", "transport": "openai-compatible",
        "base_url": "http://localhost:11434/v1", "is_local": True,
    })
    from codechroma.llm.call_site_settings import save_assignment

    save_assignment("ai_summarizer", {
        "provider_id": provider.id, "model": "llama3", "mode": "api",
    })
    calls = []

    def _stub_complete(*, user, model, max_tokens, system=None):
        calls.append(1)
        return "ok"

    monkeypatch.setattr(
        "codechroma.summarize.ai_summarizer.build_provider",
        lambda assignment: type("P", (), {"complete": staticmethod(_stub_complete)})(),
    )

    AISummarizer.from_env().summarize(_node(), context="ctx")

    assert calls == [1]
