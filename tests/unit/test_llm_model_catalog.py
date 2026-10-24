"""Unit tests for model_catalog.fetch_models against mocked HTTP model-list endpoints."""

import re
from pathlib import Path

import httpx
import pytest

from codechroma.llm.model_catalog import _STATIC_MODELS, fetch_models
from codechroma.llm.providers_store import Provider

_REPO_ROOT = Path(__file__).resolve().parents[2]


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=self)

    def json(self) -> dict:
        return self._payload


@pytest.mark.parametrize(
    ("provider", "expected_id"),
    [
        (Provider(id="p", label="l", kind="api", transport="openai-compatible"), "gpt-5.2"),
        (Provider(id="p", label="l", kind="api", transport="anthropic"), "claude-sonnet-5-5"),
        (Provider(id="p", label="l", kind="api", transport="gemini"), "gemini-2.5-pro"),
        (Provider(id="p", label="l", kind="cli", adapter="claude"), "sonnet"),
        (Provider(id="p", label="l", kind="cli", adapter="codex"), "gpt-5.2"),
        (Provider(id="p", label="l", kind="cli", adapter="kimi-cli"), "kimi-k2-thinking"),
    ],
    ids=[
        "openai_compatible_without_base_url",
        "anthropic_without_key",
        "gemini_without_key",
        "cli_claude_without_base_url",
        "cli_codex_adapter",
        "cli_kimi_adapter",
    ],
)
def test_unreachable_provider_falls_back_to_static_list(provider, expected_id):
    result = fetch_models(provider)

    assert result["supported"] is True
    assert result["static"] is True
    assert result["error"] is None
    assert expected_id in [model["id"] for model in result["models"]]


def test_unknown_cli_adapter_is_unsupported():
    provider = Provider(id="p", label="l", kind="cli", adapter="mystery")

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


def test_anthropic_transport_forwards_verify_ssl(monkeypatch):
    captured = {}

    def fake_get(url, headers, timeout, verify=True):
        captured["url"] = url
        captured["verify"] = verify
        return _FakeResponse({"data": [{"id": "claude-opus-5"}]})

    monkeypatch.setattr("codechroma.llm.model_catalog.httpx.get", fake_get)

    provider = Provider(
        id="p", label="l", kind="api", transport="anthropic", api_key="sk-x",
        verify_ssl=False,
    )
    fetch_models(provider)

    assert captured["url"] == "https://api.anthropic.com/v1/models"
    assert captured["verify"] is False


def test_gemini_transport_parses_display_name_as_label(monkeypatch):
    captured = {}

    def fake_get(url, headers, timeout, verify=True):
        captured["url"] = url
        captured["headers"] = headers
        return _FakeResponse(
            {"models": [{"name": "models/gemini-2.5-flash", "displayName": "Gemini 2.5 Flash"}]}
        )

    monkeypatch.setattr("codechroma.llm.model_catalog.httpx.get", fake_get)

    provider = Provider(id="p", label="l", kind="api", transport="gemini", api_key="g-key")
    result = fetch_models(provider)

    assert captured["url"] == "https://generativelanguage.googleapis.com/v1beta/models"
    assert captured["headers"]["x-goog-api-key"] == "g-key"
    assert result == {
        "supported": True,
        "models": [{"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash"}],
        "error": None,
    }


def test_gemini_transport_honors_base_url(monkeypatch):
    captured = {}

    def fake_get(url, headers, timeout, verify=True):
        captured["url"] = url
        return _FakeResponse({"models": []})

    monkeypatch.setattr("codechroma.llm.model_catalog.httpx.get", fake_get)

    provider = Provider(
        id="p", label="l", kind="api", transport="gemini", api_key="g-key", base_url="https://gm.example"
    )
    fetch_models(provider)

    assert captured["url"] == "https://gm.example/v1beta/models"


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


def test_static_models_match_csharp_catalog():
    source = (_REPO_ROOT / "dotnet/CodeChroma.Bridge/Stores/ModelCatalog.cs").read_text("utf-8")
    found = re.search(r"AnthropicModels = \[(.*?)\];", source)
    assert found, "AnthropicModels list not found in ModelCatalog.cs"
    anthropic = found.group(1)
    csharp = {"anthropic": re.findall(r'"([^"]+)"', anthropic)}
    csharp["transport:anthropic"] = csharp["anthropic"]
    for key, body in re.findall(r'\["((?:transport|adapter):[^"]+)"\] = \[(.*?)\],\r?\n', source):
        csharp[key] = re.findall(r'"([^"]+)"', body) + (
            csharp["anthropic"] if ".. AnthropicModels" in body else []
        )

    python = {key: list(models) for key, models in _STATIC_MODELS.items()}

    for key, models in python.items():
        assert key in csharp, f"{key} missing from ModelCatalog.cs"
        assert csharp[key] == models, key
