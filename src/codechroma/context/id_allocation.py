"""Shared flat-id allocation for c1: fresh ids for repeated bare names, plus endpoint resolution.

Used by `bridge/diagram_migration.py` (legacy conversion) to build a flat nodes/relations shape
from a nested system/actors tree.
"""

from __future__ import annotations


class IdAddressBook:
    """One namespace of flat ids: disambiguates repeats and resolves a bare-or-trail endpoint."""

    def __init__(self) -> None:
        self._used: set[str] = set()
        self._address_to_id: dict[str, str] = {}
        self._bare_seen: dict[str, int] = {}

    def fresh(self, candidate: str) -> str:
        """Disambiguates a repeated bare id (`shared`, `shared-2`, ...)."""
        if candidate not in self._used:
            self._used.add(candidate)
            return candidate
        suffix = 2
        while f"{candidate}-{suffix}" in self._used:
            suffix += 1
        unique = f"{candidate}-{suffix}"
        self._used.add(unique)
        return unique

    def address(self, trail: str, bare: str, new_id: str) -> None:
        """Records `new_id` under its full trail, and under `bare` while that bare id is unique."""
        self._address_to_id[trail] = new_id
        self._bare_seen[bare] = self._bare_seen.get(bare, 0) + 1
        if self._bare_seen[bare] == 1:
            self._address_to_id[bare] = new_id
        else:
            self._address_to_id.pop(bare, None)

    def resolve(self, ref: str) -> str | None:
        """The flat id for an authored endpoint -- a bare id (if unambiguous) or a full trail."""
        return self._address_to_id.get(ref)
