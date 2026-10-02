"""One Claude call, wrapped: every one-shot generator uses this instead of the Anthropic SDK
directly, so "build a client from env" and "unwrap response.content[0].text" each exist once.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import httpx

from codechroma.assistant import load_assistant_settings
from codechroma.config import load_env_once, settings
from codechroma.llm.providers_store import Provider, find_provider

if TYPE_CHECKING:
    from anthropic import Anthropic
    from anthropic.types import MessageParam

    from codechroma.llm.call_site_settings import Assignment

# The one cheap model every connectivity probe (assistant + per-provider) uses for its test call.
PROBE_MODEL = "claude-3-5-haiku-latest"


class LLMProvider(Protocol):
    def complete(
        self, *, user: str, model: str, max_tokens: int, system: str | None = None
    ) -> str: ...


class AnthropicProvider:
    """Wraps an Anthropic client; unwraps `response.content[0].text` in exactly one place."""

    def __init__(self, client: Anthropic) -> None:
        self._client = client

    def complete(
        self, *, user: str, model: str, max_tokens: int, system: str | None = None
    ) -> str:
        messages: list[MessageParam] = [{"role": "user", "content": user}]
        # Two calls, not **kwargs: the SDK has no overload for a dynamically-typed kwargs dict.
        response = (
            self._client.messages.create(model=model, max_tokens=max_tokens, messages=messages)
            if system is None
            else self._client.messages.create(
                model=model, max_tokens=max_tokens, messages=messages, system=system
            )
        )
        # Local import: `anthropic` is an optional dependency, guarded in _build_anthropic_provider.
        from anthropic.types import TextBlock

        block = response.content[0]
        if not isinstance(block, TextBlock):
            raise ValueError(f"unexpected first content block type: {type(block).__name__}")
        return block.text.strip()


def _resolve_key_from(api_key: str | None, api_key_path: str | None) -> str | None:
    """Shared precedence: a raw key wins, else a creds file's first non-comment line, else None."""
    if api_key:
        return api_key
    if api_key_path:
        return _read_key_file(api_key_path)
    return None


def _resolve_key() -> str | None:
    """The API key from the saved assistant settings (manual key or a creds file path), else env."""
    assistant = load_assistant_settings()
    if assistant.api_key or assistant.api_key_path:
        return _resolve_key_from(assistant.api_key, assistant.api_key_path)
    return os.environ.get("ANTHROPIC_API_KEY")


def key_source() -> str:
    """Where the effective API key comes from: settings key, settings file path, or env; 'none'."""
    assistant = load_assistant_settings()
    if assistant.api_key:
        return "settings"
    if assistant.api_key_path:
        return "file"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "env"
    return "none"


def _read_key_file(path: str) -> str | None:
    """The first non-empty line of a credentials file, trimmed; None on an unreadable file."""
    try:
        for line in Path(path).expanduser().read_text().splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                return stripped
    except OSError:
        return None
    return None


def _build_anthropic_provider(api_key: str) -> LLMProvider | None:
    """An AnthropicProvider for `api_key`, or None if the `anthropic` package isn't importable."""
    try:
        from anthropic import Anthropic
    except ImportError:
        return None
    timeout = settings.anthropic_client.request_timeout_seconds
    return AnthropicProvider(Anthropic(api_key=api_key, timeout=timeout, max_retries=1))


def provider_from_env() -> LLMProvider | None:
    """An AnthropicProvider if a key is configured (assistant settings or env) and importable."""
    load_env_once()
    api_key = _resolve_key()
    if not api_key:
        return None
    return _build_anthropic_provider(api_key)


class OpenAICompatibleProvider:
    """Adapts a chat-completions REST endpoint (Ollama, Kimi, a custom base_url) to LLMProvider."""

    def __init__(self, base_url: str, api_key: str | None, verify_ssl: bool = True) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._verify_ssl = verify_ssl

    def complete(
        self, *, user: str, model: str, max_tokens: int, system: str | None = None
    ) -> str:
        messages = []
        if system is not None:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        timeout = settings.anthropic_client.request_timeout_seconds
        response = httpx.post(
            f"{self._base_url}/chat/completions",
            json={"model": model, "messages": messages, "max_tokens": max_tokens},
            headers=headers,
            timeout=timeout,
            verify=self._verify_ssl,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"].strip()


def resolve_provider_key(provider: Provider) -> str | None:
    """A provider's own key/path, same precedence as `_resolve_key()` for assistant settings."""
    return _resolve_key_from(provider.api_key, provider.api_key_path)


def provider_to_llm(provider: Provider) -> LLMProvider | None:
    """The `LLMProvider` a stored api-kind `Provider` resolves to; `None` if misconfigured."""
    if provider.kind != "api":
        return None
    api_key = resolve_provider_key(provider)
    if provider.transport == "openai-compatible":
        if not provider.base_url:
            return None
        return OpenAICompatibleProvider(
            base_url=provider.base_url, api_key=api_key, verify_ssl=provider.verify_ssl
        )
    # transport == "anthropic"
    if not api_key:
        return None
    return _build_anthropic_provider(api_key)


def build_provider(assignment: Assignment | None) -> LLMProvider | None:
    """The assigned `LLMProvider` for a `mode="api"` assignment, else today's env-based provider."""
    # mode="cli" has no direct-API path here -- out of scope for the three one-shot generators.
    if assignment is None or assignment.mode != "api":
        return provider_from_env()
    provider = find_provider(assignment.provider_id)
    if provider is None or provider.kind != "api":
        return provider_from_env()
    return provider_to_llm(provider)


def resolve_model(assignment: Assignment | None, default: str) -> str:
    """The assignment's own model for a `mode="api"` assignment, else the call site's default."""
    if assignment is not None and assignment.mode == "api":
        return assignment.model
    return default
