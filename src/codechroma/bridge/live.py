"""Live-update plumbing for the bridge: a filesystem watcher and a WebSocket fan-out that tells
connected canvases to re-fetch whenever the repo changes on disk.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable
from pathlib import Path

from fastapi import WebSocket
from watchfiles import Change, DefaultFilter, watch

from codechroma.engine import IGNORED_DIRS as _IGNORED_DIRS

logger = logging.getLogger("codechroma.bridge.live")

# A socket that can't take a ping this long is treated as gone, so it can't stall the others.
SEND_TIMEOUT_SECONDS = 5.0


class ConnectionManager:
    """Tracks connected canvas WebSockets and broadcasts change pings from any thread."""

    # `key` scopes a connection (e.g. to a repo_id); an unkeyed broadcast still reaches everyone.

    def __init__(self) -> None:
        # Only ever touched on the app loop (broadcast_threadsafe schedules onto it), so no lock.
        self._connections: dict[WebSocket, str | None] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Records the app's event loop so the watcher thread can schedule broadcasts onto it."""
        self._loop = loop

    async def connect(self, websocket: WebSocket, key: str | None = None) -> None:
        await websocket.accept()
        self._connections[websocket] = key

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.pop(websocket, None)

    def broadcast_threadsafe(self, message: dict, key: str | None = None) -> None:
        """Schedules a broadcast onto the app loop from any thread; no-op before the loop binds."""
        loop = self._loop
        if loop is None:
            return
        asyncio.run_coroutine_threadsafe(self._broadcast(message, key), loop)

    async def broadcast(self, message: dict, key: str | None = None) -> None:
        """Sends a message to every connected socket, or only those registered under `key`."""
        await self._broadcast(message, key)

    async def _broadcast(self, message: dict, key: str | None = None) -> None:
        targets = [ws for ws, ws_key in list(self._connections.items())
                   if key is None or ws_key == key]
        if not targets:
            return
        # Concurrent, not sequential: one stuck client must not delay every other canvas's ping.
        await asyncio.gather(*(self._send(ws, message) for ws in targets))

    async def _send(self, websocket: WebSocket, message: dict) -> None:
        try:
            async with asyncio.timeout(SEND_TIMEOUT_SECONDS):
                await websocket.send_json(message)
        except Exception:
            self.disconnect(websocket)


class _Watcher:
    """Shared watchfiles thread lifecycle; subclasses pick what to watch and what to ignore."""

    _thread_name = "codechroma-watcher"
    _debounce_default = 500
    # True only for the .codechroma watchers, whose target dir may legitimately not exist yet.
    _create_target_dir = True

    def __init__(self, target: Path, on_change: Callable[[], None], debounce_ms: int | None = None):
        self._target = target.resolve()
        self._on_change = on_change
        self._debounce_ms = debounce_ms if debounce_ms is not None else self._debounce_default
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._ready.clear()
        self._thread = threading.Thread(target=self._run, name=self._thread_name, daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=5):
            self.stop()
            raise RuntimeError(f"{self._thread_name} did not start monitoring in time")

    def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=2)
        self._thread = None

    def _watch_dir(self) -> Path:
        raise NotImplementedError

    def _watch_filter(self) -> Callable[[Change, str], bool] | None:
        return None

    def _is_noise(self, changes: set[tuple[Change, str]]) -> bool:
        """Per-batch veto applied after watchfiles' own filter; nothing is noise by default."""
        return False

    def _run(self) -> None:
        # Supervised: one watchfiles crash (inotify limit, dir replaced) must not end live updates.
        backoff = 1.0
        while not self._stop.is_set():
            try:
                self._watch_once()
                return
            except Exception:
                logger.exception("%s crashed; restarting in %.0fs", self._thread_name, backoff)
            if self._stop.wait(backoff):
                return
            backoff = min(backoff * 2, 60.0)

    def _watch_once(self) -> None:
        """One watch() loop; returns when the stop event fires, raises to request a restart."""
        watch_dir = self._watch_dir()
        if self._create_target_dir:
            watch_dir.mkdir(parents=True, exist_ok=True)
        watch_filter = self._watch_filter()
        # Two calls: omitting watch_filter keeps watchfiles' own default; =None would disable it.
        changes_iter = (
            watch(
                watch_dir, debounce=self._debounce_ms, step=200, stop_event=self._stop,
                yield_on_timeout=True, rust_timeout=200,
            )
            if watch_filter is None
            else watch(
                watch_dir,
                watch_filter=watch_filter,
                debounce=self._debounce_ms,
                step=200,
                stop_event=self._stop,
                yield_on_timeout=True,
                rust_timeout=200,
            )
        )
        for changes in changes_iter:
            # watch() is lazy: only its first yield proves the OS watcher is installed.
            # Timeout yields let start() wait for readiness even when no files change.
            self._ready.set()
            if not changes or self._is_noise(changes):
                continue
            try:
                self._on_change()
            except Exception:
                logger.exception("%s on_change callback failed", self._thread_name)


class RepoWatcher(_Watcher):
    """Watches the repo in a background thread; fires a callback on each settled change batch."""

    _thread_name = "codechroma-repo-watcher"
    _debounce_default = 1000
    _create_target_dir = False

    def _watch_dir(self) -> Path:
        return self._target

    def _watch_filter(self) -> Callable[[Change, str], bool]:
        return DefaultFilter(ignore_dirs=tuple(_IGNORED_DIRS))

    def _is_noise(self, changes: set[tuple[Change, str]]) -> bool:
        """True when every path sits under an ignored dir the filter missed (e.g. .codechroma)."""
        return all(
            any(part in _IGNORED_DIRS for part in Path(path).parts) for _, path in changes
        )


class FileWatcher(_Watcher):
    """Watches a single file (e.g. .codechroma/plan.json) that RepoWatcher deliberately ignores."""

    _thread_name = "codechroma-plan-watcher"

    def _watch_dir(self) -> Path:
        return self._target.parent

    def _watch_filter(self) -> Callable[[Change, str], bool]:
        return lambda _change, path: Path(path).resolve() == self._target


class DirWatcher(_Watcher):
    """Watches a directory (e.g. .codechroma/traces) and fires on any settled change within it."""

    _thread_name = "codechroma-dir-watcher"

    def _watch_dir(self) -> Path:
        return self._target
