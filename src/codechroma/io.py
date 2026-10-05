"""Generic file IO shared by the engine and the bridge -- JSON persistence and source reading.

Lives in the core package on purpose: `bridge/` must be able to import these, but nothing in the
core may import `bridge/` back (the engine has to stay usable as a plain library).
"""

from __future__ import annotations

import contextlib
import importlib.util
import json
import logging
import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

IS_WINDOWS = os.name == "nt"

if IS_WINDOWS:
    from filelock import FileLock
else:
    import fcntl

logger = logging.getLogger(__name__)


def load_module_from_path(name: str, path: Path) -> ModuleType:
    """Imports a standalone script by file path, registered under `name` in sys.modules first."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    # Registered before exec, or its own dataclasses can't resolve their postponed annotations.
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, payload: object, mode: int | None = None) -> bool:
    """Writes payload to path via temp+rename, optionally chmod'd; returns whether it landed."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Unique per call: a fixed temp name races os.replace() between concurrent writers.
        temp = path.with_suffix(f".{os.getpid()}.{uuid.uuid4().hex}.json.tmp")
        temp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        if mode is not None:
            temp.chmod(mode)
        os.replace(temp, path)
        return True
    except OSError:
        logger.exception("write_json: could not write %s", path)
        return False


def delete_file_if_exists(path: Path) -> bool:
    """Unlinks `path` if it's there; returns whether anything was actually deleted."""
    if not path.exists():
        return False
    path.unlink()
    return True



@contextlib.contextmanager
def locked(path: Path):
    """Hold an exclusive advisory lock for a read-modify-write critical section."""
    lock_path = path.parent / f"{path.name}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    if IS_WINDOWS:
        # Windows
        lock = FileLock(str(lock_path))
        with lock:
            yield
    else:
        # Linux / macOS
        with open(lock_path, "a+") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def load_json(path: Path) -> dict:
    """Parses a JSON file, tolerating a missing or malformed file (returns {})."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def load_json_or_none(path: Path) -> dict | None:
    """Like load_json, but None on a missing/malformed file -- for callers that must tell apart."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def read_text(path: Path) -> str | None:
    """File contents, or None when it can't be read or isn't decodable text."""
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def is_within_dir(base: Path, path: Path) -> bool:
    """True when `path` resolves inside `base` -- guards a `..`/absolute-path escape."""
    try:
        return path.resolve().is_relative_to(base.resolve())
    except OSError:
        return False


def safe_read_within(base: Path, path: Path) -> str | None:
    """`read_text(path)`, but only when it actually resolves inside `base`."""
    return read_text(path) if is_within_dir(base, path) else None


def slice_lines(text: str, start_line: int, end_line: int) -> str:
    """The inclusive 1-based [start_line, end_line] span of `text`."""
    return "\n".join(text.splitlines()[max(start_line - 1, 0) : end_line])


@dataclass(slots=True)
class CharBudget:
    """A running char total against a cap -- shared by the wiki-context bundle builders."""

    max_chars: int
    used: int = 0
    truncated: bool = False

    def try_add(self, content: str) -> bool:
        """Adds `content`'s length if it fits; else sets `truncated` and returns False."""
        if self.used + len(content) > self.max_chars:
            self.truncated = True
            return False
        self.used += len(content)
        return True
