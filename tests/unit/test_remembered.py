"""Unit coverage for RememberedStore, the shared capped-LRU behind the two aliases."""

from __future__ import annotations

from codechroma.bridge.remembered import RememberedStore


def test_remember_then_get_round_trips_the_value():
    store: RememberedStore[str] = RememberedStore(3)

    store.remember("a", "first")

    assert store.get("a") == "first"


def test_get_returns_none_for_a_key_never_remembered():
    store: RememberedStore[str] = RememberedStore(3)

    assert store.get("missing") is None


def test_get_returns_the_stored_value_by_reference():
    store: RememberedStore[dict] = RememberedStore(3)
    payload = {"turns": []}
    store.remember("a", payload)

    assert store.get("a") is payload


def test_re_remembering_a_key_moves_it_to_most_recent_so_it_survives_eviction():
    store: RememberedStore[str] = RememberedStore(3)
    store.remember("a", "1")
    store.remember("b", "2")
    store.remember("c", "3")
    # Re-remembering "a" marks it most-recently-used, so "b" is the next oldest to evict.
    store.remember("a", "1-bumped")
    store.remember("d", "4")

    assert store.get("a") == "1-bumped"
    assert store.get("b") is None


def test_remember_evicts_the_oldest_key_when_over_capacity():
    store: RememberedStore[str] = RememberedStore(2)
    store.remember("a", "1")
    store.remember("b", "2")
    store.remember("c", "3")

    assert store.get("a") is None
    assert store.get("b") == "2"
    assert store.get("c") == "3"


def test_remember_replacing_a_key_does_not_grow_the_store():
    store: RememberedStore[str] = RememberedStore(2)
    store.remember("a", "1")
    store.remember("a", "1-replaced")
    store.remember("b", "2")

    assert store.get("a") == "1-replaced"
    assert len(store._items) == 2
