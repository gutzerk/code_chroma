"""One lock per workspace, guarding `canvas.json`'s read-modify-write section.

Every writer (a `PATCH`, a recipe run, the chat route's finalize step) does load -> mutate a copy
-> save with no version check; two near-simultaneous writers would otherwise silently clobber or
duplicate each other's work. A workspace-keyed `threading.Lock` is enough here -- this bridge is a
single-user, mostly-local tool, not a high-concurrency service, so a short in-process critical
section around a small JSON file is the right amount of machinery, not a full DB-style transaction.
"""

from __future__ import annotations

import threading

_registry_lock = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def canvas_lock(workspace_id: str) -> threading.Lock:
    """The one lock for `workspace_id`, created on first use."""
    with _registry_lock:
        lock = _locks.get(workspace_id)
        if lock is None:
            lock = threading.Lock()
            _locks[workspace_id] = lock
        return lock
