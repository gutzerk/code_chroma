"""Unit tests for OpenAICompatibleProvider against a mocked HTTP chat-completions endpoint."""

import httpx
import pytest

from codechroma.context.llm_provider import OpenAICompatibleProvider


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=self)

    def json(self) -> dict:
        return self._payload


def test_complete_posts_chat_completions_and_unwraps_content(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return _FakeResponse({"choices": [{"message": {"content": " ok "}}]})

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    provider = OpenAICompatibleProvider(base_url="http://localhost:11434/v1", api_key=None)
    text = provider.complete(user="hi", model="llama3", max_tokens=10)

    assert text == "ok"
    assert captured["url"] == "http://localhost:11434/v1/chat/completions"
    assert captured["json"]["model"] == "llama3"
    assert captured["json"]["messages"] == [{"role": "user", "content": "hi"}]
    assert "Authorization" not in captured["headers"]


def test_complete_includes_system_message_when_given(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["json"] = json
        return _FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    OpenAICompatibleProvider(base_url="http://x/v1", api_key=None).complete(
        user="hi", model="m", max_tokens=10, system="be terse"
    )

    assert captured["json"]["messages"][0] == {"role": "system", "content": "be terse"}


def test_complete_sends_bearer_token_when_key_set(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["headers"] = headers
        return _FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    OpenAICompatibleProvider(base_url="http://x/v1", api_key="sk-x").complete(
        user="hi", model="m", max_tokens=10
    )

    assert captured["headers"]["Authorization"] == "Bearer sk-x"


def test_complete_raises_on_http_error(monkeypatch):
    def fake_post(url, json, headers, timeout, verify=True):
        return _FakeResponse({}, status_code=500)

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    with pytest.raises(httpx.HTTPStatusError):
        OpenAICompatibleProvider(base_url="http://x/v1", api_key=None).complete(
            user="hi", model="m", max_tokens=10
        )


def test_base_url_trailing_slash_is_stripped(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["url"] = url
        return _FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    OpenAICompatibleProvider(base_url="http://x/v1/", api_key=None).complete(
        user="hi", model="m", max_tokens=10
    )

    assert captured["url"] == "http://x/v1/chat/completions"


@pytest.mark.parametrize(
    "verify_ssl,expect_verify",
    [(None, True), (False, False)],
    ids=["defaults_to_true", "false_is_passed_through"],
)
def test_verify_ssl(monkeypatch, verify_ssl, expect_verify):
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["verify"] = verify
        return _FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    kwargs = {"verify_ssl": verify_ssl} if verify_ssl is not None else {}
    OpenAICompatibleProvider(base_url="http://x/v1", api_key=None, **kwargs).complete(
        user="hi", model="m", max_tokens=10
    )

    assert captured["verify"] is expect_verify
