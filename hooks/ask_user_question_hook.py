"""PreToolUse hook: sends Claude's AskUserQuestion to `ask_user`; reroutes only if that is down."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

DEADLINE_SECONDS = 570.0
PROBE_SECONDS = 2.0
DENY_REASON = (
    "Do not use AskUserQuestion. Ask through the mcp__codechroma__ask_user tool: question, and "
    "2-4 options that each have id, title, description, pro, con and why; exactly one option "
    "has rank 1 (your recommendation). Use kind \"diagram\" with draw_option_diagram for "
    "structural questions."
)


def _ask(base_url: str, workspace_id: str, token: str, payload: dict, timeout: float) -> dict:
    request = urllib.request.Request(
        f"{base_url}/repos/{workspace_id}/questions/ask",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def bridge_answers(base_url: str) -> bool:
    """Whether the bridge's /mcp endpoint responds at all (any HTTP status counts)."""
    try:
        urllib.request.urlopen(f"{base_url}/mcp/", timeout=PROBE_SECONDS).close()
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False
    return True


def deny_decision() -> dict:
    """The hook output that refuses the native tool and names the one to use instead."""
    return {"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": DENY_REASON,
    }}


def env(name: str, default: str = "") -> str:
    """The CODECHROMA_* variable, falling back to the lower-cased spelling older builds used."""
    legacy = name.replace("CODECHROMA_", "codechroma_", 1)
    return os.environ.get(name) or os.environ.get(legacy) or default


def build_payload(question: dict, index: int, total: int, session_id: str) -> dict:
    """One AskUserQuestion entry as a degraded `ask_user` request (no pros, cons or rank)."""
    options = [
        {
            "id": str(i), "title": option.get("label", ""),
            "description": option.get("description", ""),
        }
        for i, option in enumerate(question.get("options", []))
    ]
    return {
        "question": question.get("question", ""), "options": options, "session_id": session_id,
        "total": total, "allow_custom": True, "allow_skip": True,
        "agent_id": env("CODECHROMA_WORKSPACE_ID") or None, "degraded": True,
    }


def collect_answers(questions: list[dict], ask) -> dict[str, str] | None:
    """Asks each question in turn; None when any is skipped or still pending (caller fails open)."""
    session_id = f"ask-{uuid.uuid4().hex[:8]}"
    answers: dict[str, str] = {}
    for index, question in enumerate(questions):
        result = ask(build_payload(question, index, len(questions), session_id))
        answer = result.get("answer")
        if result.get("pending") or result.get("skipped") or not answer:
            return None
        answers[question.get("question", "")] = answer
    return answers


def decision(tool_input: dict, answers: dict[str, str]) -> dict:
    """The hook output that auto-answers the tool with the user's canvas choices."""
    return {"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "allow",
        "updatedInput": {**tool_input, "answers": answers},
    }}


def main() -> int:
    """Reads the hook event on stdin; prints a decision only when every question was answered."""
    base_url = env("CODECHROMA_BRIDGE_URL").rstrip("/")
    token = env("CODECHROMA_QUESTION_TOKEN")
    workspace_id = env("CODECHROMA_WORKSPACE_ID")
    if not (base_url and token and workspace_id):
        return 0
    try:
        tool_input = json.load(sys.stdin).get("tool_input") or {}
        questions = tool_input.get("questions") or []
        if not questions:
            return 0
        if bridge_answers(base_url):
            sys.stdout.write(json.dumps(deny_decision()))
            return 0
        deadline = time.monotonic() + DEADLINE_SECONDS

        def ask(payload: dict) -> dict:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("hook deadline reached")
            return _ask(base_url, workspace_id, token, payload, remaining)

        answers = collect_answers(questions, ask)
        if answers is not None:
            sys.stdout.write(json.dumps(decision(tool_input, answers)))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
