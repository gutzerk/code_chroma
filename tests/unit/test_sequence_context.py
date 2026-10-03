"""The sequence context provider's trace-to-scaffold reduction (bridge/context_providers.py)."""

from __future__ import annotations

from codechroma.bridge.context_providers import _sequence_scaffold


def test_scaffold_builds_participants_and_distinct_messages():
    trace = {
        "steps": [
            {
                "event": "call", "caller_node_id": "component::client.py",
                "node_id": "component::api.py", "args": "x",
            },
            {
                "event": "return", "caller_node_id": "component::api.py",
                "node_id": "component::client.py", "args": None,
            },
            {
                "event": "call", "caller_node_id": "component::api.py",
                "node_id": "component::db.py", "args": "y",
            },
            # A repeated identical hop collapses (hot loop), a self-call is skipped.
            {
                "event": "call", "caller_node_id": "component::api.py",
                "node_id": "component::db.py", "args": "y",
            },
            {
                "event": "call", "caller_node_id": "component::api.py",
                "node_id": "component::api.py", "args": "self",
            },
        ],
    }

    participants, messages = _sequence_scaffold(trace)

    assert [p["name"] for p in participants] == ["client.py", "api.py", "db.py"]
    assert [m["order"] for m in messages] == [1, 2]
    assert messages[0]["from"] == "component::client.py"
    assert messages[0]["to"] == "component::api.py"


def test_scaffold_uses_full_node_id_as_id_and_short_name():
    participants, messages = _sequence_scaffold(
        {"steps": [{"event": "call", "caller_node_id": "a", "node_id": "b", "args": None}]}
    )

    assert participants[0]["id"] == "a"
    assert participants[0]["node_id"] == "a"
    assert participants[1]["name"] == "b"
    assert messages[0]["from"] == "a"
