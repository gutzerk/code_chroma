"""What models a stored `Provider` claims to serve -- queried live, else a built-in suggestion list.

Feeds the Model routing tab's "Fetch models" action (`CallSitesSection.tsx`): a provider that can
answer is asked directly; one that can't (no key/URL, or a CLI) gets `_STATIC_MODELS`
(flagged `static`).
`fetch_models` never raises -- same "never a non-2xx for a reachability failure" convention as
`bridge/routes/llm_settings.py`'s `_run_provider_test`.
"""

from __future__ import annotations

import httpx

from codechroma.config import settings
from codechroma.context.llm_provider import GEMINI_DEFAULT_BASE_URL, resolve_provider_key
from codechroma.llm.providers_store import Provider

_ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com"
_UNSUPPORTED: dict = {"supported": False, "models": [], "error": None}

_ANTHROPIC_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]
_STATIC_MODELS: dict[str, list[str]] = {
    "transport:anthropic": _ANTHROPIC_MODELS,
    "transport:gemini": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "transport:openai-compatible": ["gpt-5.2", "gpt-5.2-pro"],
    "adapter:claude": ["opus", "sonnet", "haiku", *_ANTHROPIC_MODELS],
    "adapter:codex": ["gpt-5.2", "gpt-5.2-codex"],
    "adapter:kimi-cli": ["kimi-k2-turbo-preview", "kimi-k2-thinking"],
}


def _static_models(key: str) -> dict:
    """The built-in suggestion list for `key`, flagged `static` so the UI can say it isn't live."""
    models = [{"id": model, "label": None} for model in _STATIC_MODELS[key]]
    return {"supported": True, "models": models, "error": None, "static": True}


def fetch_models(provider: Provider) -> dict:
    """`{"supported", "models", "error"}`, or the built-in list (`"static": True`)."""
    if provider.kind == "api" and provider.transport == "openai-compatible":
        if not provider.base_url:
            return _static_models("transport:openai-compatible")
        return _fetch_openai_compatible(provider)
    if provider.kind == "api" and provider.transport == "anthropic":
        key = resolve_provider_key(provider)
        if not key:
            return _static_models("transport:anthropic")
        base_url = provider.base_url or _ANTHROPIC_DEFAULT_BASE_URL
        return _fetch_anthropic_shape(base_url, key, verify=provider.verify_ssl)
    if provider.kind == "api" and provider.transport == "gemini":
        key = resolve_provider_key(provider)
        if not key:
            return _static_models("transport:gemini")
        base_url = provider.base_url or GEMINI_DEFAULT_BASE_URL
        return _fetch_gemini_shape(base_url, key, verify=provider.verify_ssl)
    if provider.kind == "cli" and provider.adapter == "claude" and provider.base_url:
        key = resolve_provider_key(provider)
        return _fetch_anthropic_shape(provider.base_url, key, verify=provider.verify_ssl)
    if provider.kind == "cli" and f"adapter:{provider.adapter}" in _STATIC_MODELS:
        return _static_models(f"adapter:{provider.adapter}")
    return dict(_UNSUPPORTED)


def _fetch_models_json(url: str, headers: dict, *, verify: bool) -> dict:
    """GET `url` and return parsed JSON, or the `{"supported", "models", "error"}` failure shape.

    Never raises -- same "never a non-2xx for a reachability failure" convention as `fetch_models`.
    """
    try:
        response = httpx.get(
            url,
            headers=headers,
            timeout=settings.anthropic_client.request_timeout_seconds,
            verify=verify,
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        return {"supported": True, "models": [], "error": str(exc)}


def _fetch_openai_compatible(provider: Provider) -> dict:
    key = resolve_provider_key(provider)
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    url = f"{provider.base_url.rstrip('/')}/models"
    data = _fetch_models_json(url, headers, verify=provider.verify_ssl)
    if "error" in data:
        return data
    items = data.get("data", []) if isinstance(data, dict) else []
    models = [
        {"id": item["id"], "label": None}
        for item in items
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]
    return {"supported": True, "models": models, "error": None}


def _fetch_anthropic_shape(base_url: str, key: str | None, *, verify: bool = True) -> dict:
    headers = {"anthropic-version": "2023-06-01"}
    if key:
        headers["x-api-key"] = key
    url = f"{base_url.rstrip('/')}/v1/models"
    data = _fetch_models_json(url, headers, verify=verify)
    if "error" in data:
        return data
    items = data.get("data", []) if isinstance(data, dict) else []
    models = [
        {"id": item["id"], "label": item.get("display_name")}
        for item in items
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]
    return {"supported": True, "models": models, "error": None}


def _fetch_gemini_shape(base_url: str, key: str, *, verify: bool = True) -> dict:
    """Gemini's models-list shape: id in `name` (`models/<id>`), label in `displayName`."""
    headers = {"x-goog-api-key": key}
    url = f"{base_url.rstrip('/')}/v1beta/models"
    data = _fetch_models_json(url, headers, verify=verify)
    if "error" in data:
        return data
    items = data.get("models", []) if isinstance(data, dict) else []
    models = [
        {"id": item["name"].removeprefix("models/"), "label": item.get("displayName")}
        for item in items
        if isinstance(item, dict)
        and isinstance(item.get("name"), str)
        and item["name"].startswith("models/")
    ]
    return {"supported": True, "models": models, "error": None}
