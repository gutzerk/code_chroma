"""The one root every CodeChroma error inherits from.

Before this module each subsystem invented its own exception straight off `RuntimeError`/`KeyError`,
so nothing could catch "any failure from this package" -- and 42 route handlers hand-translated
these into `HTTPException`, mapping `WorktreeError` to 400 in one route and 409 in four others.

Deliberately no HTTP knowledge here: status codes are a transport concern and live in
`bridge/errors.py`, which owns the table and installs the single FastAPI handler.
"""

from __future__ import annotations

from typing import Any


class codechromaError(Exception):
    """Root of every CodeChroma error; carries structured context rather than a baked message."""

    def __init__(
        self,
        message: object,
        *,
        context: dict[str, Any] | None = None,
        cause: Exception | None = None,
    ) -> None:
        super().__init__(message)
        # `object`, not `str`: UnknownPrError is raised with the PR number, an int.
        self.message = message
        self.context: dict[str, Any] = dict(context or {})
        self.cause = cause

    def __str__(self) -> str:
        """The message, with any accumulated context appended so logs keep the detail."""
        if not self.context:
            return str(self.message)
        detail = ", ".join(f"{key}={value}" for key, value in self.context.items())
        return f"{self.message} ({detail})"
