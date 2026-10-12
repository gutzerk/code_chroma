"""Refuses state-changing requests that a web page on another origin sent to the local bridge.

CORS only stops a page *reading* a response. A cross-origin `text/plain` POST is a "simple request"
that still reaches the handler, and `json_body` parses it whatever the content type, so every write
route (open a branch, create a GitHub issue, run an agent) would be reachable from any site the
user has open. Browsers always attach `Origin` to such a request, so refusing an unsafe method whose
`Origin` is neither this server's own nor an allowed dev origin closes it. Callers that send no
`Origin` (the skills' curl/python, the desktop shell's fetch, tests) are unaffected.
"""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def is_cross_origin(origin: str, host: str, allowed: set[str]) -> bool:
    """Whether `origin` is neither the host the request addressed nor an explicitly allowed one."""
    return origin not in allowed and urlparse(origin).netloc != host


def install_origin_guard(app: FastAPI, allowed_origins: list[str]) -> None:
    allowed = {origin.strip() for origin in allowed_origins if origin.strip()}

    @app.middleware("http")
    async def _origin_guard(request: Request, call_next):
        origin = request.headers.get("origin")
        if (
            request.method in _UNSAFE_METHODS
            and origin
            and is_cross_origin(origin, request.headers.get("host", ""), allowed)
        ):
            return JSONResponse(
                status_code=403, content={"detail": "cross-origin request refused"}
            )
        return await call_next(request)
