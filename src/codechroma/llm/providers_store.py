"""Machine-local provider connections: `~/.codechroma/llm-providers.json`.

Mirrors `assistant.py`'s idiom (dataclass + free `validate()`/`from_payload()`/`load_...()`/
`save_...()` functions), but for a *named collection* instead of one settings object -- a provider
is user-created, has a server-assigned `id`, and can be deleted while still referenced (checked by
the caller against `call_site_settings`, since that's a cross-store concern the route owns).
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from codechroma.io import load_json_or_none, locked, write_json
from codechroma.llm.cli_adapters import CLI_ADAPTERS

PROVIDERS_ENV = "codechroma_LLM_PROVIDERS_FILE"
SCHEMA_VERSION = 1

KINDS = ("cli", "api")
TRANSPORTS = ("anthropic", "gemini", "openai-compatible")


def store_path(env_var: str, default_filename: str) -> Path:
    """Resolve a configured path or the default path shared by both LLM stores."""
    configured = os.environ.get(env_var, "")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codechroma" / default_filename


def providers_path() -> Path:
    """The store file: `$codechroma_LLM_PROVIDERS_FILE` when set, else `~/.codechroma/...`."""
    return store_path(PROVIDERS_ENV, "llm-providers.json")


@dataclass
class Provider:
    id: str
    label: str
    kind: str
    adapter: str | None = None
    transport: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    api_key_path: str | None = None
    is_local: bool = False
    test_model: str | None = None
    # openai-compatible, or a "claude" cli provider's own base_url: skips TLS cert verification.
    verify_ssl: bool = True

    def masked(self) -> dict:
        """A UI-safe payload: the raw key is replaced by a boolean, everything else shown as-is."""
        return {
            "id": self.id,
            "label": self.label,
            "kind": self.kind,
            "adapter": self.adapter,
            "transport": self.transport,
            "base_url": self.base_url,
            "api_key_set": bool(self.api_key),
            "api_key_path": self.api_key_path,
            "is_local": self.is_local,
            "test_model": self.test_model,
            "verify_ssl": self.verify_ssl,
        }


def validate(payload: object) -> list[str]:
    """Returns a list of problems; empty means the payload is acceptable to save."""
    if not isinstance(payload, dict):
        return ["provider must be an object"]
    problems: list[str] = []
    label = payload.get("label")
    if not isinstance(label, str) or not label.strip():
        problems.append("label must be a non-empty string")
    kind = payload.get("kind")
    if kind not in KINDS:
        problems.append(f"kind must be one of {KINDS}")
        return problems  # nothing else below is checkable without a valid kind
    if kind == "cli":
        adapter = payload.get("adapter")
        if adapter not in CLI_ADAPTERS:
            problems.append(f"adapter must be one of {sorted(CLI_ADAPTERS)}")
        # Optional -- only the "claude" adapter reads these (a custom Anthropic-protocol proxy).
        base_url = payload.get("base_url")
        api_key = payload.get("api_key")
        api_key_path = payload.get("api_key_path")
        if adapter != "claude" and (base_url or api_key or api_key_path):
            problems.append("base_url/api_key/api_key_path are only valid for the claude adapter")
        if base_url is not None and (not isinstance(base_url, str) or not base_url.strip()):
            problems.append("base_url must be a non-empty string when given")
        if api_key and api_key_path:
            problems.append("provide an api_key OR an api_key_path, not both")
        return problems
    # kind == "api"
    transport = payload.get("transport")
    if transport not in TRANSPORTS:
        problems.append(f"transport must be one of {TRANSPORTS}")
    if transport == "openai-compatible":
        base_url = payload.get("base_url")
        if not isinstance(base_url, str) or not base_url.strip():
            problems.append("base_url is required for an openai-compatible transport")
    test_model = payload.get("test_model")
    if test_model is not None and (not isinstance(test_model, str) or not test_model.strip()):
        problems.append("test_model must be a non-empty string when given")
    is_local = payload.get("is_local", False)
    api_key = payload.get("api_key")
    api_key_path = payload.get("api_key_path")
    if api_key and api_key_path:
        problems.append("provide an api_key OR an api_key_path, not both")
    if not is_local and not api_key and not api_key_path:
        problems.append("a non-local api provider needs an api_key or api_key_path")
    return problems


def from_payload(provider_id: str, payload: dict) -> Provider:
    """Coerces a stored/validated dict into a Provider, ignoring unknown/invalid fields."""
    raw_kind = payload.get("kind")
    kind = raw_kind if isinstance(raw_kind, str) and raw_kind in KINDS else "api"
    return Provider(
        id=provider_id,
        label=payload.get("label", "") if isinstance(payload.get("label"), str) else "",
        kind=kind,
        adapter=payload.get("adapter") if isinstance(payload.get("adapter"), str) else None,
        transport=payload.get("transport") if isinstance(payload.get("transport"), str) else None,
        base_url=payload.get("base_url") if isinstance(payload.get("base_url"), str) else None,
        api_key=payload.get("api_key") if isinstance(payload.get("api_key"), str) else None,
        api_key_path=payload.get("api_key_path")
        if isinstance(payload.get("api_key_path"), str)
        else None,
        is_local=bool(payload.get("is_local", False)),
        test_model=payload.get("test_model")
        if isinstance(payload.get("test_model"), str)
        else None,
        verify_ssl=bool(payload.get("verify_ssl", True)),
    )


def draft_from_payload(payload: dict) -> Provider:
    """Builds a transient, unpersisted Provider from a form draft, for the pre-save Test button."""
    return from_payload("draft", _normalize_keys(payload))


def load_providers() -> dict[str, Provider]:
    """Every stored provider, keyed by id; empty when nothing's saved yet."""
    data = load_json_or_none(providers_path()) or {}
    raw = data.get("providers", {})
    if not isinstance(raw, dict):
        return {}
    return {
        provider_id: from_payload(provider_id, entry)
        for provider_id, entry in raw.items()
        if isinstance(entry, dict)
    }


def find_provider(provider_id: str) -> Provider | None:
    return load_providers().get(provider_id)


def _persist(providers: dict[str, Provider]) -> None:
    # 0o600: this file holds plaintext api_key values, unlike most other write_json callers.
    write_json(
        providers_path(),
        {
            "schema_version": SCHEMA_VERSION,
            "providers": {
                provider_id: {
                    "label": provider.label,
                    "kind": provider.kind,
                    "adapter": provider.adapter,
                    "transport": provider.transport,
                    "base_url": provider.base_url,
                    "api_key": provider.api_key,
                    "api_key_path": provider.api_key_path,
                    "is_local": provider.is_local,
                    "test_model": provider.test_model,
                    "verify_ssl": provider.verify_ssl,
                }
                for provider_id, provider in providers.items()
            },
        },
        mode=0o600,
    )


def create_provider(payload: dict) -> Provider:
    """Validates, assigns a new id, and persists; raises ValueError listing every problem."""
    problems = validate(payload)
    if problems:
        raise ValueError("; ".join(problems))
    with locked(providers_path()):
        providers = load_providers()
        provider_id = uuid.uuid4().hex[:12]
        provider = from_payload(provider_id, _normalize_keys(payload))
        providers[provider_id] = provider
        _persist(providers)
        return provider


def update_provider(provider_id: str, payload: dict) -> Provider | None:
    """Validates, merging onto the existing stored fields; None if provider_id doesn't exist."""
    with locked(providers_path()):
        providers = load_providers()
        existing = providers.get(provider_id)
        if existing is None:
            return None
        merged = {**existing.masked(), **_normalize_keys(payload)}
        merged.pop("id", None)
        merged.pop("api_key_set", None)
        # A masked GET round-trips: "api_key_set present, api_key absent" means "keep as-is".
        if "api_key_set" in payload and "api_key" not in payload:
            merged["api_key"] = existing.api_key
        problems = validate(merged)
        if problems:
            raise ValueError("; ".join(problems))
        updated = from_payload(provider_id, merged)
        providers[provider_id] = updated
        _persist(providers)
        return updated


def delete_provider(provider_id: str) -> bool:
    """True if a provider was removed; the caller checks for blocking assignments first."""
    with locked(providers_path()):
        providers = load_providers()
        if provider_id not in providers:
            return False
        del providers[provider_id]
        _persist(providers)
        return True


def _normalize_keys(payload: dict) -> dict:
    """Empty-string keys/paths mean "clear", same as `assistant.py`'s save path."""
    data = dict(payload)
    if data.get("api_key") == "":
        data["api_key"] = None
    if data.get("api_key_path") == "":
        data["api_key_path"] = None
    return data
