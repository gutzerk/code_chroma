"""Bridge-hosted MCP server: a non-blocking `ask_user` tool and its `ask_user_result` read-back."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

from mcp.server.mcpserver import Context, MCPServer
from starlette.applications import Starlette
from starlette.responses import Response

from codechroma.bridge.workspaces import Workspace
from codechroma.config import settings
from codechroma.questions import diagrams, store
from codechroma.questions.launch import McpEndpoint, bearer_token, discover_base_url, loopback_url
from codechroma.questions.models import AskRequest, QuestionOption, QuestionResult
from codechroma.questions.validation import (
    QuestionRejected,
    RejectionTracker,
    rejection_text,
    unknown_refs,
    validate_ask,
)

SERVER_NAME = "codechroma"
MOUNT_PATH = "/mcp"
_INSTRUCTIONS = (
    "Ask every decision question through ask_user, never in chat text and never with another "
    "question tool. Each call needs: question, and 2-4 options that each have id, title, "
    "description, pro, con and why; exactly one option has rank 1 (your recommendation), the "
    "others a unique rank. A call that breaks this is rejected with the list of problems: fix "
    "them and call again with the same intent. For a question that changes structure "
    "(boundaries, data flow, ownership, a new component) use kind \"diagram\": first draw one "
    "small diagram per option with draw_option_diagram, then pass each returned diagram_ref on "
    "its option. ask_user returns at once with {asked: true}: end your turn then. The user's "
    "answer arrives as your next message, starting with [CodeChroma answer]. If the next "
    "message says the user wants diagrams, draw them with draw_option_diagram and call ask_user "
    "again with the same session_id and question. Never poll and never repeat the question in "
    "chat. ask_user_result(question_id) reads an answer back if you need it."
)

NEXT_STEP = "End your turn now. The user's answer will arrive as your next message."
MISSING_DESCRIPTIONS = (
    "More than half the nodes have no description; say what changes for each node under "
    "this option."
)

_DRAW_DESCRIPTION = (
    "Draw a small decision diagram (max 12 nodes) for one option; returns its diagram_ref. "
    'Nodes are {id, label, description?, status?}; status "new" marks a part that does not exist '
    "yet. Edges are {from, to, label?}. Pass the returned diagram_ref on the option in ask_user."
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

    def __init__(self, workspace_for: Callable[[str], Workspace]) -> None:
        self.rejections = RejectionTracker()
        self._workspace_for = workspace_for
        self._secret = secrets.token_bytes(32)
        self._server = MCPServer(SERVER_NAME, instructions=_INSTRUCTIONS)
        self._server.tool(name="ask_user")(self._ask_user_tool)
        self._server.tool(name="ask_user_result")(self._ask_user_result_tool)
        self._server.tool(name="draw_option_diagram", description=_DRAW_DESCRIPTION)(
            self._draw_option_diagram_tool
        )
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

    async def ask(
        self, workspace_id: str, request: AskRequest, connection: str | None = None
    ) -> dict[str, Any]:
        """Opens (or re-opens) the question and returns at once; the answer is typed in later."""
        ws = self._workspace_for(workspace_id)
        extra = await self._check(ws, workspace_id, request, connection)
        request.agent_id = workspace_id
        found = await asyncio.to_thread(store.find_diagram_requested, ws, request)
        reasked, stale = found if found else (None, [])
        question_id = reasked.meta["question_id"] if reasked else uuid.uuid4().hex
        if reasked:
            await asyncio.to_thread(store.reask, ws, reasked, request, extra, stale)
        else:
            await asyncio.to_thread(store.open_question, ws, request, question_id, extra)
        return {"asked": True, "question_id": question_id, "next": NEXT_STEP}

    async def _check(
        self, ws: Workspace, workspace_id: str, request: AskRequest, connection: str | None = None
    ) -> dict | None:
        """Raises QuestionRejected on a contract break; at the retry limit lets one through."""
        if request.degraded:
            return {"degraded": True}
        problems = validate_ask(request)
        if not problems and any(option.diagram_ref for option in request.options):
            known = await asyncio.to_thread(store.known_element_ids, ws)
            problems = unknown_refs(request, known)
        tracker = self.rejections
        key = request.session_id or (f"conn:{connection}" if connection else None)
        if not problems:
            tracker.reset(workspace_id, key)
            return None
        text = rejection_text(problems)
        if tracker.count(workspace_id, key) < settings.questions.max_rejections:
            tracker.record(workspace_id, key)
            raise QuestionRejected(text)
        tracker.reset(workspace_id, key)
        return {"degraded": True, "validation": text}

    async def draw_diagram(
        self, workspace_id: str, title: str, nodes: list[diagrams.DiagramNode],
        edges: list[diagrams.DiagramEdge], question_id: str | None, option_id: str | None,
    ) -> dict[str, Any]:
        """Draws one option diagram after the node budget check; returns its `diagram_ref`."""
        diagrams.check(nodes, edges, title)
        ws = self._workspace_for(workspace_id)
        root = await asyncio.to_thread(
            store.draw_diagram, ws, title, nodes, edges, question_id, option_id
        )
        if diagrams.missing_descriptions(nodes):
            return {"diagram_ref": root, "warning": MISSING_DESCRIPTIONS}
        return {"diagram_ref": root}

    async def result(self, workspace_id: str, question_id: str) -> dict[str, Any]:
        """The settled answer read from the canvas element, or `{pending: true, question_id}`."""
        ws = self._workspace_for(workspace_id)
        element = await asyncio.to_thread(store.find_element, ws, question_id)
        found = (element and store.result_from(element)) or QuestionResult(
            pending=True, question_id=question_id
        )
        return found.to_tool_dict()

    def _sign(self, workspace_id: str) -> str:
        return hmac.new(self._secret, workspace_id.encode(), hashlib.sha256).hexdigest()

    def _workspace_id(self, ctx: Context) -> str:
        return self.workspace_id_for(bearer_token(ctx.headers or {}))

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
    ) -> dict[str, Any]:
        """Ask the user a question on the canvas; returns at once, so end your turn."""
        request = AskRequest(
            question=question, options=options or [], kind=kind, session_id=session_id,
            allow_custom=allow_custom, allow_skip=allow_skip, total=total,
        )
        connection = (ctx.headers or {}).get("mcp-session-id")
        return await self.ask(self._workspace_id(ctx), request, connection)

    async def _ask_user_result_tool(self, question_id: str, ctx: Context) -> dict[str, Any]:
        """Fetch the answer of an earlier ask_user call that returned pending."""
        return await self.result(self._workspace_id(ctx), question_id)

    async def _draw_option_diagram_tool(
        self,
        title: str,
        nodes: list[diagrams.DiagramNode],
        ctx: Context,
        edges: list[diagrams.DiagramEdge] | None = None,
        question_id: str | None = None,
        option_id: str | None = None,
    ) -> dict[str, Any]:
        """Draw a small decision diagram (max 12 nodes) for one option; returns its diagram_ref."""
        return await self.draw_diagram(
            self._workspace_id(ctx), title, nodes, edges or [], question_id, option_id
        )
