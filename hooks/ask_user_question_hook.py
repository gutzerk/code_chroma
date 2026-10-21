"""PreToolUse hook: reroutes Claude's AskUserQuestion to the CodeChroma canvas; fails open."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import uuid

DEADLINE_SECONDS = 570.0


def _ask(base_url: str, workspace_id: str, token: str, payload: dict, timeout: float) -> dict:
    request = urllib.request.Request(
        f"{base_url}/repos/{workspace_id}/questions/ask",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def build_payload(question: dict, index: int, total: int, session_id: str) -> dict:
    """One AskUserQuestion entry as an `ask_user` request; option 1 is the recommendation."""
    options = [
        {
            "id": str(i), "title": option.get("label", ""),
            "description": option.get("description", ""), "rank": 1 if i == 0 else None,
        }
        for i, option in enumerate(question.get("options", []))
    ]
    return {
        "question": question.get("question", ""), "options": options, "session_id": session_id,
        "total": total, "allow_custom": True, "allow_skip": True,
        "agent_id": os.environ.get("codechroma_WORKSPACE_ID"),
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
    base_url = os.environ.get("codechroma_BRIDGE_URL", "").rstrip("/")
    token = os.environ.get("codechroma_QUESTION_TOKEN", "")
    workspace_id = os.environ.get("codechroma_WORKSPACE_ID", "")
    if not (base_url and token and workspace_id):
        return 0
    try:
        tool_input = json.load(sys.stdin).get("tool_input") or {}
        questions = tool_input.get("questions") or []
        if not questions:
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
