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
# Stdlib-only, so a copy of live_status.TARGET_KEYS: the tool_input keys the bridge reads.
TARGET_KEYS = ("file_path", "command", "pattern", "url")
# The SessionStart source (also its hook matcher) of a `/clear`, which clears the window's history.
CLEAR_SOURCE = "clear"


def is_clear(report: dict) -> bool:
    """Whether a report is the SessionStart that `/clear` or one of its aliases fires."""
    return report.get("hook_event_name") == "SessionStart" and report.get("source") == CLEAR_SOURCE


def env(name: str) -> str:
    """The CODECHROMA_* variable, falling back to the lower-cased spelling older builds used."""
    legacy = name.replace("CODECHROMA_", "codechroma_", 1)
    return os.environ.get(name) or os.environ.get(legacy) or ""


def decision_output(behavior: str) -> dict:
    """Claude's answer to a PermissionRequest the canvas decided."""
    return {"hookSpecificOutput": {
        "hookEventName": "PermissionRequest", "decision": {"behavior": behavior},
    }}


def prompt_context_output(context: str) -> dict:
    """Claude's answer to a UserPromptSubmit with pending context: hidden, for that prompt."""
    return {"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit", "additionalContext": context,
    }}


def slim(report: dict) -> dict:
    """Only what the bridge reads off a report, never `tool_response` (it can be a whole file)."""
    keys = ("hook_event_name", "tool_name", "notification_type", "source")
    kept = {k: report[k] for k in keys if k in report}
    tool_input = report.get("tool_input")
    if isinstance(tool_input, dict):
        kept["tool_input"] = {k: tool_input[k] for k in TARGET_KEYS if k in tool_input}
    return kept


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
    """Posts stdin; prints a canvas decision or pending prompt context; errors exit 0."""
    base_url = env("CODECHROMA_BRIDGE_URL").rstrip("/")
    token, agent_id = env("CODECHROMA_QUESTION_TOKEN"), env("CODECHROMA_WORKSPACE_ID")
    if not (base_url and token and agent_id):
        return 0
    try:
        payload = json.loads(input_stream.read())
        report = slim(payload if isinstance(payload, dict) else {})
        permission = report.get("hook_event_name") == "PermissionRequest"
        url = f"{base_url}/agents/{urllib.parse.quote(agent_id, safe='')}/hook"
        timeout = POST_TIMEOUT_SECONDS + (PERMISSION_WAIT_SECONDS if permission else 0.0)
        body = json.dumps(report, ensure_ascii=False, separators=(",", ":"))
        reply = sender(url, token, body, timeout)
        decision = json.loads(reply).get("decision") if permission and reply else None
        if decision in ("allow", "deny"):
            output.write(json.dumps(decision_output(decision)))
        prompt = report.get("hook_event_name") == "UserPromptSubmit"
        context = json.loads(reply).get("additional_context") if prompt and reply else None
        if isinstance(context, str) and context:
            output.write(json.dumps(prompt_context_output(context)))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.stdin, sys.stdout))
