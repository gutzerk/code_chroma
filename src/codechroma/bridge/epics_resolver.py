"""Builds the requirements/delivery sources once per workspace and answers the two epics routes.

Mirrors patterns_resolver.py: module-level functions over a passed-in workspace rather than a class
(D-12) -- a source object holds only a root path, so construction is cheap and the caching here is
about not re-parsing the configured URI on every request, not about holding state.
"""

from __future__ import annotations

import threading
from pathlib import Path

from codechroma.config import settings
from codechroma.requirements.assembler import EpicsAssembler
from codechroma.requirements.source import SourceRegistry

_registry = SourceRegistry.with_defaults()
_assemblers: dict[Path, EpicsAssembler] = {}
_lock = threading.Lock()


def _build_assembler(root: Path) -> EpicsAssembler:
    config = settings.requirements
    requirements = _registry.for_uri(config.requirements_source_uri, root)
    delivery = _registry.delivery_for_uri(config.delivery_source_uri, root)
    return EpicsAssembler(
        requirements=requirements,
        delivery=delivery,
        config=config,
        source_uri=config.requirements_source_uri,
    )


def assembler_for(root: Path) -> EpicsAssembler:
    """The workspace's EpicsAssembler, built once and cached by root."""
    with _lock:
        cached = _assemblers.get(root)
        if cached is None:
            cached = _build_assembler(root)
            _assemblers[root] = cached
        return cached


def epics_index(root: Path) -> dict:
    return assembler_for(root).index()


def epics_item(root: Path, item_id: str, expand: str | None = None) -> dict | None:
    return assembler_for(root).item(item_id, expand)


def resolve_source_uri(uri: str, root: Path) -> Path:
    """A configured source uri resolved against `root`; a bare path is treated as file://."""
    _scheme, _, rest = uri.partition("://") if "://" in uri else ("file", "", uri)
    path = Path(rest)
    return path if path.is_absolute() else root / rest


def external_watch_paths(root: Path) -> list[Path]:
    """Configured source dirs outside `root` -- RepoWatcher never sees their edits (D-08)."""
    config = settings.requirements
    root_resolved = root.resolve()
    candidates = {
        resolve_source_uri(config.requirements_source_uri, root).resolve(),
        resolve_source_uri(config.delivery_source_uri, root).resolve(),
    }
    return [
        path for path in candidates if root_resolved != path and root_resolved not in path.parents
    ]
