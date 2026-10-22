"""Unit coverage for TraceArchive: load, path-traversal safety, and sidecar-based summaries."""

import json
import os

from codechroma.bridge.trace_archive import TraceArchive


def _write(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")


def test_load_returns_the_parsed_trace(tmp_path):
    _write(tmp_path / "t1.json", {"id": "t1", "steps": []})

    loaded = TraceArchive(tmp_path).load("t1")

    assert loaded == {"id": "t1", "steps": []}


def test_load_returns_empty_dict_for_a_missing_trace(tmp_path):
    loaded = TraceArchive(tmp_path).load("nope")

    assert loaded == {}


def test_load_returns_empty_dict_for_malformed_json(tmp_path):
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")

    loaded = TraceArchive(tmp_path).load("bad")

    assert loaded == {}


def test_load_strips_path_traversal_from_the_id(tmp_path):
    traces = tmp_path / "traces"
    traces.mkdir()
    _write(tmp_path / "secret.json", {"leak": True})

    loaded = TraceArchive(traces).load("../secret")

    assert loaded == {}


def test_list_summaries_is_empty_for_a_missing_directory(tmp_path):
    summaries = TraceArchive(tmp_path / "absent").list_summaries()

    assert summaries == []


def test_summary_without_a_sidecar_counts_steps_and_defaults_status(tmp_path):
    _write(tmp_path / "t1.json", {"entry": "main", "created_at": "c", "steps": [1, 2, 3]})

    summaries = TraceArchive(tmp_path).list_summaries()

    assert summaries == [
        {"id": "t1", "entry": "main", "created_at": "c", "status": "ok", "step_count": 3}
    ]


def test_summary_prefers_the_meta_sidecar_over_parsing_the_trace(tmp_path):
    (tmp_path / "t1.json").write_text("{not json", encoding="utf-8")
    _write(
        tmp_path / "t1.meta.json",
        {"id": "t1", "entry": "run", "created_at": "c", "status": "error", "step_count": 9},
    )

    summaries = TraceArchive(tmp_path).list_summaries()

    assert summaries == [
        {"id": "t1", "entry": "run", "created_at": "c", "status": "error", "step_count": 9}
    ]


def test_meta_sidecars_are_not_listed_as_traces_themselves(tmp_path):
    _write(tmp_path / "t1.json", {"steps": []})
    _write(tmp_path / "t1.meta.json", {"step_count": 0})

    summaries = TraceArchive(tmp_path).list_summaries()

    assert [s["id"] for s in summaries] == ["t1"]


def test_unreadable_trace_without_a_sidecar_is_skipped(tmp_path):
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")

    summaries = TraceArchive(tmp_path).list_summaries()

    assert summaries == []


def test_summaries_are_listed_newest_first(tmp_path):
    _write(tmp_path / "old.json", {"steps": []})
    _write(tmp_path / "new.json", {"steps": []})
    os.utime(tmp_path / "old.json", (1_000, 1_000))
    os.utime(tmp_path / "new.json", (2_000, 2_000))

    summaries = TraceArchive(tmp_path).list_summaries()

    assert [s["id"] for s in summaries] == ["new", "old"]
