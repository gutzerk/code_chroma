"""Unit tests for model_catalog.fetch_models against mocked HTTP model-list endpoints."""

import httpx

from codechroma.llm.model_catalog import fetch_models
from codechroma.llm.providers_store import Provider


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=self)

    def json(self) -> dict:
        return self._payload


def test_openai_compatible_without_base_url_is_unsupported():
    provider = Provider(id="p", label="l", kind="api", transport="openai-compatible")

    result = fetch_models(provider)

    assert result == {"supported": False, "models": [], "error": None}


def test_openai_compatible_parses_data_list(monkeypatch):
    def fake_get(url, headers, timeout, verify=True):
        assert url == "http://x/v1/models"
        return _FakeResponse({"data": [{"id": "llama3"}, {"id": "mistral"}]})

    monkeypatch.setattr("codechroma.llm.model_catalog.httpx.get", fake_get)

    provider = Provider(
        id="p", label="l", kind="api", transport="openai-compatible", base_url="http://x/v1"
    )
    result = fetch_models(provider)

    assert result == {
        "supported": True,
        "models": [{"id": "llama3", "label": None}, {"id": "mistral", "label": None}],
        "error": None,
    }


def test_anthropic_transport_without_key_is_unsupported():
    provider = Provider(id="p", label="l", kind="api", transport="anthropic")

    result = fetch_models(provider)

    assert result == {"supported": False, "models": [], "error": None}


def test_anthropic_transport_parses_display_name_as_label(monkeypatch):
    captured = {}

    def fake_get(url, headers, timeout, verify=True):
        captured["url"] = url
        captured["headers"] = headers
        return _FakeResponse(
            {"data": [{"id": "claude-opus-5", "display_name": "Claude Opus 5"}]}
        )

    monkeypatch.setattr("codechroma.llm.model_catalog.httpx.get", fake_get)

    provider = Provider(id="p", label="l", kind="api", transport="anthropic", api_key="sk-x")
    result = fetch_models(provider)

    assert captured["url"] == "https://api.anthropic.com/v1/models"
    assert captured["headers"]["x-api-key"] == "sk-x"
    assert result == {
        "supported": True,
        "models": [{"id": "claude-opus-5", "label": "Claude Opus 5"}],
        "error": None,
    }


def test_cli_claude_with_base_url_is_supported(monkeypatch):
    captured = {}

    def fake_get(url, headers, timeout, verify=True):
        captured["url"] = url
        captured["headers"] = headers
        captured["verify"] = verify
        return _FakeResponse({"data": [{"id": "deepseek-v4-pro"}]})

    monkeypatch.setattr("codechroma.llm.model_catalog.httpx.get", fake_get)

    provider = Provider(
        id="p", label="l", kind="cli", adapter="claude", base_url="https://proxy.example.com",
        verify_ssl=False,
    )
    result = fetch_models(provider)

    assert captured["url"] == "https://proxy.example.com/v1/models"
    assert captured["verify"] is False
    assert "x-api-key" not in captured["headers"]
    assert result == {
        "supported": True,
        "models": [{"id": "deepseek-v4-pro", "label": None}],
        "error": None,
    }


def test_cli_claude_without_base_url_is_unsupported():
    provider = Provider(id="p", label="l", kind="cli", adapter="claude")

    result = fetch_models(provider)

    assert result == {"supported": False, "models": [], "error": None}


def test_cli_non_claude_adapter_is_unsupported():
    provider = Provider(
        id="p", label="l", kind="cli", adapter="codex", base_url="http://x"
    )

    result = fetch_models(provider)

    assert result == {"supported": False, "models": [], "error": None}


def test_network_error_reports_supported_with_error_message(monkeypatch):
    def fake_get(url, headers, timeout, verify=True):
        raise ConnectionError("boom")

    monkeypatch.setattr("codechroma.llm.model_catalog.httpx.get", fake_get)

    provider = Provider(
        id="p", label="l", kind="api", transport="openai-compatible", base_url="http://x/v1"
    )
    result = fetch_models(provider)

    assert result["supported"] is True
    assert result["models"] == []
    assert "boom" in result["error"]


def test_non_2xx_response_reports_supported_with_error_message(monkeypatch):
    def fake_get(url, headers, timeout, verify=True):
        return _FakeResponse({}, status_code=401)

    monkeypatch.setattr("codechroma.llm.model_catalog.httpx.get", fake_get)

    provider = Provider(
        id="p", label="l", kind="api", transport="openai-compatible", base_url="http://x/v1"
    )
    result = fetch_models(provider)

    assert result["supported"] is True
    assert result["models"] == []
    assert result["error"] is not None
