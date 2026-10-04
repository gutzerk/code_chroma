"""Assistant-settings routes: read and update which assistant the app uses.

Not repo-scoped: the settings live in the user's home directory, so these have no `Services`
dependency. GET returns a masked payload (the raw key never leaves the host); PUT validates and
persists, applying to the running bridge on the next use.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from codechroma.assistant import load_assistant_settings, save_assistant_settings
from codechroma.bridge.routes._body import json_body
from codechroma.context.llm_provider import PROBE_MODEL, key_source, provider_from_env
from codechroma.llm.runtime_env import CliLookupError, resolve_runtime_cli

router = APIRouter()


@router.get("/assistant/settings")
def get_assistant_settings() -> dict:
    """Effective settings, with any stored API key masked to a boolean."""
    return load_assistant_settings().masked()


@router.put("/assistant/settings")
async def put_assistant_settings(request: Request) -> dict:
    """Validates and persists the settings; also reloads anything keyed from them on next use."""
    body = await json_body(request)
    # A masked GET payload round-trips: reconstruct a saveable object from the masked shape.
    if "api_key_set" in body and "api_key" not in body:
        body = {**body, "api_key": None}
    try:
        saved = save_assistant_settings(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return saved.masked()


@router.post("/assistant/settings/test")
def test_assistant_connection() -> dict:
    """Checks the assistant works now: CLI present, plus one tiny call if a key resolves."""
    settings = load_assistant_settings()
    cli = settings.effective_cli
    problems: list[str] = []
    try:
        resolve_runtime_cli(cli)
        cli_found = True
    except CliLookupError as exc:
        cli_found = False
        problems.append(str(exc))

    source = key_source()
    provider = provider_from_env() if source != "none" else None

    if source == "none":
        problems.append("no API key configured (settings file, key path, or ANTHROPIC_API_KEY)")
        return _probe_result(False, cli, cli_found, source, "; ".join(problems))

    if provider is None:
        problems.append("anthropic SDK not importable")
        return _probe_result(False, cli, cli_found, source, "; ".join(problems))

    try:
        text = provider.complete(
            user="Reply with the single word: ok",
            model=PROBE_MODEL,
            max_tokens=1,
        )
    except Exception as exc:
        return _probe_result(False, cli, cli_found, source, str(exc))

    return _probe_result(True, cli, cli_found, source, message=text[:40])


def _probe_result(
    ok: bool,
    cli: str,
    cli_found: bool,
    auth_source: str,
    error: str | None = None,
    message: str | None = None,
) -> dict:
    """One connection-probe payload shape, so callers stay short and the shape stays single."""
    result = {"ok": ok, "cli": cli, "cli_found": cli_found, "auth_source": auth_source}
    if error is not None:
        result["error"] = error
    if message is not None:
        result["message"] = message
    return result
