"""What models a stored `Provider` itself claims to serve -- queried live, never a hardcoded list.

Feeds the Model routing tab's "Fetch models" action (`CallSitesSection.tsx`): a provider that can
answer is asked directly, so the picker never guesses a name the target doesn't actually recognize.
`fetch_models` never raises -- same "never a non-2xx for a reachability failure" convention as
`bridge/routes/llm_settings.py`'s `_run_provider_test`.
"""

from __future__ import annotations

import httpx

from codechroma.config import settings
from codechroma.context.llm_provider import resolve_provider_key
from codechroma.llm.providers_store import Provider

_ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com"
_UNSUPPORTED: dict = {"supported": False, "models": [], "error": None}


def fetch_models(provider: Provider) -> dict:
    """`{"supported", "models": [{"id", "label"}], "error"}` -- never raises."""
    if provider.kind == "api" and provider.transport == "openai-compatible":
        if not provider.base_url:
            return dict(_UNSUPPORTED)
        return _fetch_openai_compatible(provider)
    if provider.kind == "api" and provider.transport == "anthropic":
        key = resolve_provider_key(provider)
        if not key:
            return dict(_UNSUPPORTED)
        base_url = provider.base_url or _ANTHROPIC_DEFAULT_BASE_URL
        return _fetch_anthropic_shape(base_url, key)
    if provider.kind == "cli" and provider.adapter == "claude" and provider.base_url:
        key = resolve_provider_key(provider)
        return _fetch_anthropic_shape(provider.base_url, key, verify=provider.verify_ssl)
    return dict(_UNSUPPORTED)


def _fetch_openai_compatible(provider: Provider) -> dict:
    key = resolve_provider_key(provider)
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    url = f"{provider.base_url.rstrip('/')}/models"
    try:
        response = httpx.get(
            url,
            headers=headers,
            timeout=settings.anthropic_client.request_timeout_seconds,
            verify=provider.verify_ssl,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        return {"supported": True, "models": [], "error": str(exc)}
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
    try:
        response = httpx.get(
            url,
            headers=headers,
            timeout=settings.anthropic_client.request_timeout_seconds,
            verify=verify,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        return {"supported": True, "models": [], "error": str(exc)}
    items = data.get("data", []) if isinstance(data, dict) else []
    models = [
        {"id": item["id"], "label": item.get("display_name")}
        for item in items
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]
    return {"supported": True, "models": models, "error": None}
