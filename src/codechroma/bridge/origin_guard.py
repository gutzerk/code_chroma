"""Refuses unsafe-method HTTP and any WebSocket handshake from a foreign `Origin`."""

from __future__ import annotations

from urllib.parse import urlparse

from starlette.types import ASGIApp, Receive, Scope, Send

_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def is_cross_origin(origin: str, host: str, allowed: set[str]) -> bool:
    """Whether `origin` is neither an explicitly allowed one nor this loopback server itself."""
    if origin in allowed:
        return False
    # Same netloc alone is not enough: a DNS-rebound page sends Origin and Host as its own name.
    return urlparse(origin).netloc != host or urlparse(origin).hostname not in _LOOPBACK_HOSTS


class OriginGuard:
    """ASGI middleware: 403 for a foreign-origin write, close(1008) for a foreign-origin socket."""

    def __init__(self, app: ASGIApp, allowed_origins: list[str]) -> None:
        self.app = app
        self.allowed = {origin.strip() for origin in allowed_origins if origin.strip()}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope["type"]
        if kind not in ("http", "websocket") or (
            kind == "http" and scope["method"] not in _UNSAFE_METHODS
        ):
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope["headers"]}
        origin = headers.get("origin")
        if origin and is_cross_origin(origin, headers.get("host", ""), self.allowed):
            await _refuse(kind, receive, send)
            return
        await self.app(scope, receive, send)


async def _refuse(kind: str, receive: Receive, send: Send) -> None:
    if kind == "websocket":
        await receive()
        await send({"type": "websocket.close", "code": 1008})
        return
    body = b'{"detail":"cross-origin request refused"}'
    await send(
        {
            "type": "http.response.start",
            "status": 403,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
