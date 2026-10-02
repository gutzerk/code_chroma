"""Shared "hash of sorted lines" fingerprint shape, used by change/pattern/item staleness checks."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable


def hash_lines(lines: Iterable[str]) -> str:
    """Stable sha1 hex digest of the given lines, sorted so ordering never affects the result."""
    return hashlib.sha1("\n".join(sorted(lines)).encode()).hexdigest()
