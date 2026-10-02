"""Service that resolves Widget across the src-layout package root via a module alias."""
import pkg.models as m


class Factory:
    """Builds widgets; deliberately mixes a resolvable call with unresolvable ones."""

    def __init__(self):
        self._cache = {}

    def make(self, name: str):
        widget = m.build(name)
        self._cache[name] = widget
        return self._local_helper(widget)

    def _local_helper(self, widget):
        return widget.name
