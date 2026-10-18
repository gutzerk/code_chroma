"""Bridge-hosted MCP server: a blocking `ask_user` tool and its `ask_user_result` poll fallback."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

from mcp.server.mcpserver import Context, MCPServer
from starlette.applications import Starlette
from starlette.responses import Response

from codechroma.bridge.workspaces import Workspace
from codechroma.config import settings
from codechroma.questions import store
from codechroma.questions.broker import QuestionBroker
from codechroma.questions.launch import McpEndpoint, discover_base_url, loopback_url
from codechroma.questions.models import AskRequest, QuestionOption

SERVER_NAME = "codechroma"
MOUNT_PATH = "/mcp"
_INSTRUCTIONS = (
    "Ask the user a decision question on the CodeChroma canvas instead of in chat text. "
    "Give 2-4 options, mark your recommendation with rank 1, and add a short pro and con."
)


class QuestionAuthError(PermissionError):
    """The request carried no valid per-workspace token."""


class _Delegate:
    """Stable ASGI mount target that forwards to whichever MCP app is currently running."""

    def __init__(self, owner: QuestionMcp) -> None:
        self._owner = owner

    async def __call__(self, scope, receive, send) -> None:
        app = self._owner._app
        if app is None:
            if scope["type"] == "http":
                await Response("question server not running", status_code=503)(
                    scope, receive, send
                )
            return
        await app(scope, receive, send)


class QuestionMcp:
    """One MCP server for every workspace; the bearer token names and authorizes the workspace."""

    def __init__(self, broker: QuestionBroker, workspace_for: Callable[[str], Workspace]) -> None:
        self.broker = broker
        self._workspace_for = workspace_for
        self._secret = secrets.token_bytes(32)
        self._server = MCPServer(SERVER_NAME, instructions=_INSTRUCTIONS)
        self._server.tool(name="ask_user")(self._ask_user_tool)
        self._server.tool(name="ask_user_result")(self._ask_user_result_tool)
        self._app: Starlette | None = None
        self.asgi = _Delegate(self)
        self.base_url: str | None = None

    def token_for(self, workspace_id: str) -> str:
        """The bearer token for one workspace: `<workspace_id>.<hmac>`; stable for this process."""
        return f"{workspace_id}.{self._sign(workspace_id)}"

    def remember_base_url(self, request_base_url: str) -> None:
        """Learns the bridge's port from a request's base URL when no explicit one is known."""
        self.base_url = loopback_url(request_base_url) or self.base_url

    def endpoint_for(self, workspace_id: str) -> McpEndpoint | None:
        """What an agent window needs to reach /mcp, or None while the bridge's port is unknown."""
        base_url = discover_base_url() or self.base_url
        if base_url is None:
            return None
        return McpEndpoint(workspace_id, base_url, self.token_for(workspace_id))

    def workspace_id_for(self, token: str | None) -> str:
        """The workspace id a token names; raises QuestionAuthError if malformed or forged."""
        workspace_id, _, signature = (token or "").rpartition(".")
        if not workspace_id or not hmac.compare_digest(signature, self._sign(workspace_id)):
            raise QuestionAuthError("invalid or missing workspace token")
        return workspace_id

    @asynccontextmanager
    async def running(self) -> AsyncIterator[None]:
        """Serves `asgi` for the duration; a fresh session manager per run (each runs once)."""
        app = self._server.streamable_http_app(streamable_http_path="/")
        self._app = app
        try:
            async with app.router.lifespan_context(app):
                yield
        finally:
            self._app = None

    async def ask(self, workspace_id: str, request: AskRequest) -> dict[str, Any]:
        """Opens the question on the canvas, blocks for the answer, or returns pending."""
        ws = self._workspace_for(workspace_id)
        question_id, _ = await asyncio.to_thread(store.open_question, ws, request)
        self.broker.open(question_id)
        result = await self.broker.wait(question_id, settings.questions.ask_wait_seconds)
        return result.to_tool_dict()

    async def result(self, workspace_id: str, question_id: str) -> dict[str, Any]:
        """The settled answer, read from the broker or (after a restart) the canvas element."""
        found = self.broker.lookup(question_id)
        if found.pending:
            ws = self._workspace_for(workspace_id)
            element = await asyncio.to_thread(store.find_element, ws, question_id)
            found = (element and store.result_from(element)) or found
        return found.to_tool_dict()

    def _sign(self, workspace_id: str) -> str:
        return hmac.new(self._secret, workspace_id.encode(), hashlib.sha256).hexdigest()

    def _workspace_id(self, ctx: Context) -> str:
        header = (ctx.headers or {}).get("authorization", "")
        return self.workspace_id_for(header.removeprefix("Bearer ").strip() or None)

    async def _ask_user_tool(
        self,
        question: str,
        ctx: Context,
        options: list[QuestionOption] | None = None,
        kind: str = "choices",
        session_id: str | None = None,
        allow_custom: bool = True,
        allow_skip: bool = True,
        total: int | None = None,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Ask the user a question on the canvas and wait for the answer (or a pending id)."""
        request = AskRequest(
            question=question, options=options or [], kind=kind, session_id=session_id,
            allow_custom=allow_custom, allow_skip=allow_skip, total=total, agent_id=agent_id,
        )
        return await self.ask(self._workspace_id(ctx), request)

    async def _ask_user_result_tool(self, question_id: str, ctx: Context) -> dict[str, Any]:
        """Fetch the answer of an earlier ask_user call that returned pending."""
        return await self.result(self._workspace_id(ctx), question_id)
