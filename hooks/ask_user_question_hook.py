"""PreToolUse hook: denies native AskUserQuestion in favour of `ask_user`; fails open if unsure."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

PROBE_SECONDS = 0.5
DENY_REASON = (
    "Do not use AskUserQuestion. Ask through the mcp__codechroma__ask_user tool: question, and "
    "2-4 options that each have id, title, description, pro, con and why; exactly one option "
    "has rank 1 (your recommendation). Use kind \"diagram\" with draw_option_diagram for "
    "structural questions."
)


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


def main() -> int:
    """Denies only when the launcher wired the codechroma MCP server (token env) and /mcp is up."""
    base_url = env("CODECHROMA_BRIDGE_URL").rstrip("/")
    if not (base_url and env("CODECHROMA_QUESTION_TOKEN") and env("CODECHROMA_WORKSPACE_ID")):
        return 0
    try:
        tool_input = json.load(sys.stdin).get("tool_input") or {}
        if tool_input.get("questions") and bridge_answers(base_url):
            sys.stdout.write(json.dumps(deny_decision()))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
