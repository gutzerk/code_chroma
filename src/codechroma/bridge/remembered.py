"""A shared capped-LRU in-memory store, the once-written primitive behind `ResearchQueryLog`.

`ResearchQueryLog` and the now-retired `DraftTranscripts` (the diagram-type interview's transcript
store) were structurally identical capped LRUs -- one remembered str->str question journals, the
other draft->turn-list transcripts -- and differed only in read semantics. This store is that
primitive once; an alias layers its exact read behavior on top so callers that mutate a returned
list never corrupt stored state.
"""

from __future__ import annotations

from collections import OrderedDict


class RememberedStore[T]:
    """A capped LRU keyed store; `get()` returns the stored value by reference."""

    def __init__(self, max_items: int) -> None:
        self._items: OrderedDict[str, T] = OrderedDict()
        self._max_items = max_items

    def remember(self, key: str, value: T) -> None:
        """Stores/replaces `value`, marking `key` most-recently-used and evicting the oldest."""
        self._items[key] = value
        self._items.move_to_end(key)
        while len(self._items) > self._max_items:
            self._items.popitem(last=False)

    def get(self, key: str) -> T | None:
        """The stored value, by reference; None when nothing was ever remembered for `key`."""
        return self._items.get(key)
