"""Maps an escaped domain error to its HTTP status, in one table instead of 42 route try/excepts.

`STATUS_BY_ERROR` records the status each error already produced before this module existed, so
installing the handler changes no response. `WorktreeError` is the one error routes disagreed about
-- 400 in `POST /agents`, 409 in the four others -- so 409 is its default here and `POST /agents`
keeps its explicit 400.

A route still catches explicitly when it replaces the message with different user-facing wording
("unknown agent: x" rather than git's stderr); that is a wording decision, not duplicated plumbing.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from codechroma.bridge.agents.bootstrap import BootstrapError
from codechroma.bridge.agents.main_branch import (
    CheckoutError,
    DirtyWorkingTreeError,
    UnknownBranchError,
)
from codechroma.bridge.agents.manager import AgentLimitError, UnknownAgentError
from codechroma.bridge.agents.publish import PublishError
from codechroma.bridge.agents.sessions import AgentStartError
from codechroma.bridge.agents.worktree import WorktreeError
from codechroma.bridge.git_accept import DiffNotFoundError, GitCommandError, GitConflictError
from codechroma.bridge.git_long import GitLongError
from codechroma.bridge.prs.manager import PrLimitError, UnknownPrError
from codechroma.context.structure import UnknownRootError
from codechroma.errors import codechromaError

logger = logging.getLogger("uvicorn.error")

STATUS_BY_ERROR: dict[type[BaseException], int] = {
    # Not found.
    UnknownAgentError: 404,
    UnknownPrError: 404,
    UnknownBranchError: 404,
    UnknownRootError: 404,
    DiffNotFoundError: 404,
    # The request is well-formed but the repository is in a state that refuses it.
    AgentLimitError: 409,
    PrLimitError: 409,
    AgentStartError: 409,
    CheckoutError: 409,
    DirtyWorkingTreeError: 409,
    GitConflictError: 409,
    GitLongError: 409,
    PublishError: 409,
    WorktreeError: 409,
    # The caller sent something this repository cannot act on.
    BootstrapError: 400,
    # git itself failed in a way no caller can fix.
    GitCommandError: 500,
}


def status_for(error: BaseException) -> int:
    """Walks the MRO so a subclass inherits its base's status; 500 for anything unmapped."""
    for kind in type(error).__mro__:
        status = STATUS_BY_ERROR.get(kind)
        if status is not None:
            return status
    return 500


def install_error_handler(app: FastAPI) -> None:
    """Turns any domain error that reaches the transport edge into its mapped JSON response."""

    @app.exception_handler(codechromaError)
    async def _handle(_request: Request, exc: Exception) -> JSONResponse:
        status = status_for(exc)
        # 5xx means we have a bug rather than a refused request, so keep the traceback.
        if status >= 500:
            logger.exception("bridge: unhandled %s", type(exc).__name__)
        return JSONResponse(status_code=status, content={"detail": str(exc)})
