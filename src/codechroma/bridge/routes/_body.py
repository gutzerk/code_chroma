"""Lenient request-body readers: a malformed body is an empty one, never a framework 422."""

from __future__ import annotations

from fastapi import Request


async def json_body(request: Request) -> dict:
    """The request's JSON object, or {} for an empty or non-object body."""
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


def as_list(value: object) -> list:
    return value if isinstance(value, list) else []


def as_count(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0
