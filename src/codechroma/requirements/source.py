"""RequirementsSource / DeliverySource protocols, SourceRegistry, CompositeDeliverySource.

Mirrors codechroma.analyzers.registry's LanguageAnalyzer + AnalyzerRegistry shape (for_file ->
for_uri). This is the feature's whole extension seam: a new kind of source implements one protocol
and registers a scheme; nothing in assembler.py or routes/epics.py changes (contracts/ports.md).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Protocol, runtime_checkable

from codechroma.requirements.models import ItemRef, Stage, WorkItem


@runtime_checkable
class RequirementsSource(Protocol):
    """One place work items come from -- a markdown directory, a tracker project, a repo."""

    scheme: str

    def list_items(self) -> list[ItemRef]: ...
    def fetch_item(self, item_id: str) -> WorkItem | None: ...
    def fingerprint(self) -> str: ...


@runtime_checkable
class DeliverySource(Protocol):
    """Where one work item's delivery artifacts live -- files now, a PR or subtasks later."""

    scheme: str

    def stages_for(self, item_id: str, expand: str | None = None) -> list[Stage]: ...


# (items_root, repo_root) -> adapter; repo_root lets an adapter compute a repo-relative source_ref.
RequirementsFactory = Callable[[Path, Path], RequirementsSource]
DeliveryFactory = Callable[[Path, Path], DeliverySource]


class CompositeDeliverySource:
    """Merges several delivery sources so one work item can show artifacts from all of them."""

    scheme = "composite"

    def __init__(self, members: list[DeliverySource]) -> None:
        self._members = members

    def stages_for(self, item_id: str, expand: str | None = None) -> list[Stage]:
        stages: list[Stage] = []
        for member in self._members:
            stages.extend(member.stages_for(item_id, expand))
        return stages


def _split_uri(uri: str) -> tuple[str, str]:
    """Splits "scheme://rest" into (scheme, rest); an unschemed string is treated as a bare path."""
    if "://" not in uri:
        return "file", uri
    scheme, _, rest = uri.partition("://")
    return scheme, rest


class SourceRegistry:
    """Selects a source adapter by URI scheme -- mirrors AnalyzerRegistry.for_file()."""

    def __init__(self) -> None:
        self._requirements: dict[str, RequirementsFactory] = {}
        self._delivery: dict[str, DeliveryFactory] = {}

    def register_requirements(self, scheme: str, factory: RequirementsFactory) -> None:
        self._requirements[scheme] = factory

    def register_delivery(self, scheme: str, factory: DeliveryFactory) -> None:
        self._delivery[scheme] = factory

    def for_uri(self, uri: str, root: Path) -> RequirementsSource | None:
        scheme, rest = _split_uri(uri)
        factory = self._requirements.get(scheme)
        if factory is None:
            return None
        items_root = Path(rest) if Path(rest).is_absolute() else root / rest
        return factory(items_root, root)

    def delivery_for_uri(self, uri: str, root: Path) -> DeliverySource | None:
        scheme, rest = _split_uri(uri)
        factory = self._delivery.get(scheme)
        if factory is None:
            return None
        items_root = Path(rest) if Path(rest).is_absolute() else root / rest
        return factory(items_root, root)

    @classmethod
    def with_defaults(cls) -> SourceRegistry:
        """Registers the markdown adapters only -- the deliberate mirror of AnalyzerRegistry's."""
        from codechroma.requirements.markdown.epic_source import MarkdownRequirementsSource
        from codechroma.requirements.markdown.speckit_source import SpeckitDeliverySource

        registry = cls()
        registry.register_requirements("file", MarkdownRequirementsSource)
        registry.register_delivery("file", SpeckitDeliverySource)
        return registry
