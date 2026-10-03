"""Unit tests for GeminiProvider against a mocked `generateContent` HTTP endpoint."""

import httpx
import pytest

from codechroma.context.llm_provider import GeminiProvider


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=self)

    def json(self) -> dict:
        return self._payload


def test_complete_posts_generate_content_and_unwraps_text(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        captured["verify"] = verify
        return _FakeResponse(
            {"candidates": [{"content": {"parts": [{"text": " ok "}]}}]}
        )

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    provider = GeminiProvider(base_url="https://gemini.example", api_key="g-key")
    text = provider.complete(user="hi", model="gemini-2.5-flash", max_tokens=10)

    assert text == "ok"
    assert captured["url"] == "https://gemini.example/v1beta/models/gemini-2.5-flash:generateContent"
    assert captured["json"]["contents"] == [{"role": "user", "parts": [{"text": "hi"}]}]
    assert captured["json"]["generationConfig"] == {"maxOutputTokens": 10}
    assert captured["headers"]["x-goog-api-key"] == "g-key"
    assert captured["verify"] is True


def test_complete_includes_system_instruction_when_given(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["json"] = json
        return _FakeResponse({"candidates": [{"content": {"parts": [{"text": "ok"}]}}]})

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    GeminiProvider(base_url="https://gemini.example", api_key=None).complete(
        user="hi", model="m", max_tokens=10, system="be terse"
    )

    assert captured["json"]["systemInstruction"] == {"parts": [{"text": "be terse"}]}


def test_complete_omits_goog_key_when_unset(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["headers"] = headers
        return _FakeResponse({"candidates": [{"content": {"parts": [{"text": "ok"}]}}]})

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    GeminiProvider(base_url="https://gemini.example", api_key=None).complete(
        user="hi", model="m", max_tokens=10
    )

    assert "x-goog-api-key" not in captured["headers"]


def test_complete_forwards_verify_ssl(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["verify"] = verify
        return _FakeResponse({"candidates": [{"content": {"parts": [{"text": "ok"}]}}]})

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    GeminiProvider(base_url="https://gemini.example", api_key=None, verify_ssl=False).complete(
        user="hi", model="m", max_tokens=10
    )

    assert captured["verify"] is False


def test_complete_raises_on_http_error(monkeypatch):
    def fake_post(url, json, headers, timeout, verify=True):
        return _FakeResponse({}, status_code=500)

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    provider = GeminiProvider(base_url="https://gemini.example", api_key="g-key")
    with pytest.raises(httpx.HTTPStatusError):
        provider.complete(user="hi", model="m", max_tokens=10)
