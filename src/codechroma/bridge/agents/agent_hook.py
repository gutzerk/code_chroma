"""Stdlib-only Claude Code hook: forwards one status report to `POST /agents/{id}/hook`."""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from typing import TextIO

EVENTS = (
    "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "Notification", "PermissionRequest",
)
# Events whose hook entry carries a tool matcher ("*" = every tool).
TOOL_EVENTS = ("PreToolUse", "PostToolUse", "PermissionRequest")
# Short: the terminal dialog only shows once the hook returns, so the canvas gets one second.
PERMISSION_WAIT_SECONDS = 1.0
POST_TIMEOUT_SECONDS = 2.0
HOOK_TIMEOUT_SECONDS = 10


def env(name: str) -> str:
    """The CODECHROMA_* variable, falling back to the lower-cased spelling older builds used."""
    legacy = name.replace("CODECHROMA_", "codechroma_", 1)
    return os.environ.get(name) or os.environ.get(legacy) or ""


def decision_output(behavior: str) -> dict:
    """Claude's answer to a PermissionRequest the canvas decided."""
    return {"hookSpecificOutput": {
        "hookEventName": "PermissionRequest", "decision": {"behavior": behavior},
    }}


def post(url: str, token: str, body: str, timeout: float) -> str | None:
    """The reply body of a 2xx POST, or None on any other outcome."""
    request = urllib.request.Request(
        url, data=body.encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8")
    except Exception:
        return None


def run(input_stream: TextIO, output: TextIO, sender=post) -> int:
    """Posts stdin; prints a decision only for an answered PermissionRequest; errors exit 0."""
    base_url = env("CODECHROMA_BRIDGE_URL").rstrip("/")
    token, agent_id = env("CODECHROMA_QUESTION_TOKEN"), env("CODECHROMA_WORKSPACE_ID")
    if not (base_url and token and agent_id):
        return 0
    try:
        text = input_stream.read()
        payload = json.loads(text)
        event = payload.get("hook_event_name") if isinstance(payload, dict) else None
        permission = event == "PermissionRequest"
        url = f"{base_url}/agents/{urllib.parse.quote(agent_id, safe='')}/hook"
        timeout = POST_TIMEOUT_SECONDS + (PERMISSION_WAIT_SECONDS if permission else 0.0)
        reply = sender(url, token, text, timeout)
        decision = json.loads(reply).get("decision") if permission and reply else None
        if decision in ("allow", "deny"):
            output.write(json.dumps(decision_output(decision)))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.stdin, sys.stdout))
