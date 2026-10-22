"""How an agent window learns the bridge's MCP endpoint: URL discovery and the Claude MCP config."""

from __future__ import annotations

import json
import os
import sys
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from codechroma.config import settings

URL_ENV = "CODECHROMA_BRIDGE_URL"
TOKEN_ENV = "CODECHROMA_QUESTION_TOKEN"
WORKSPACE_ENV = "CODECHROMA_WORKSPACE_ID"
SERVER_NAME = "codechroma"
_LOOPBACK = "127.0.0.1"


@dataclass(frozen=True)
class McpEndpoint:
    """Where one workspace's agent reaches the bridge: its base URL and its bearer token."""

    workspace_id: str
    base_url: str
    token: str

    @property
    def mcp_url(self) -> str:
        return f"{self.base_url}/mcp/"

    def env(self) -> dict[str, str]:
        """Env for the agent process, read by the AskUserQuestion hook."""
        return {URL_ENV: self.base_url, TOKEN_ENV: self.token}

    def claude_config(self) -> dict:
        """The `--mcp-config` document: one http server with a bearer header and a long timeout."""
        timeout_ms = int((settings.questions.ask_wait_seconds + 60) * 1000)
        return {"mcpServers": {SERVER_NAME: {
            "type": "http", "url": self.mcp_url,
            "headers": {"Authorization": f"Bearer {self.token}"}, "timeout": timeout_ms,
        }}}


def bearer_token(headers: Mapping[str, str]) -> str | None:
    """The bearer token of an `Authorization` header, or None when absent or empty."""
    return headers.get("authorization", "").removeprefix("Bearer ").strip() or None


def loopback_url(url: str) -> str | None:
    """`scheme://127.0.0.1:port` for a request's base URL; None when it carries no explicit port."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{_LOOPBACK}:{parts.port}" if parts.port else None


def discover_base_url(argv: list[str] | None = None) -> str | None:
    """The bridge's own URL: the env override, else uvicorn's `--port` on this process's argv."""
    explicit = os.environ.get(URL_ENV, "").strip().rstrip("/")
    if explicit:
        return explicit
    args = sys.argv if argv is None else argv
    for index, arg in enumerate(args):
        if arg == "--port" and index + 1 < len(args):
            value = args[index + 1]
        elif arg.startswith("--port="):
            value = arg.partition("=")[2]
        else:
            continue
        if value.isdigit():
            return f"http://{_LOOPBACK}:{int(value)}"
    return None


def identity_env(workspace_id: str) -> dict[str, str]:
    """Env that tells skills and check scripts which workspace and bridge they belong to."""
    base_url = discover_base_url()
    env = {WORKSPACE_ENV: workspace_id}
    if base_url:
        env[URL_ENV] = base_url
    return env


def write_claude_config(endpoint: McpEndpoint) -> Path:
    """Writes the MCP config to a private temp file (inline JSON gets mangled by PTY quoting)."""
    directory = Path(tempfile.gettempdir()) / "codechroma-mcp"
    directory.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in endpoint.workspace_id)
    path = directory / f"{safe}.json"
    path.write_text(json.dumps(endpoint.claude_config()), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return path
