"""Integration coverage for the trace runner: capturing call/return and raise/unwind steps."""

import json

import pytest

from codechroma.trace.run import record_trace, write_trace

_SOURCE = '''
def inner(x):
    return x + 1


def outer(x):
    return inner(x) + 1


def guarded():
    try:
        return raiser()
    except ValueError:
        return "caught"


def raiser():
    raise ValueError("boom")
'''


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "scenario.py").write_text(_SOURCE, encoding="utf-8")
    return tmp_path


def test_call_and_return_steps_are_captured(repo):
    trace = record_trace(repo, "import scenario; scenario.outer(1)", use_monitoring=False)

    events = [(s.event, s.node_id) for s in trace.steps]
    assert ("call", "scenario.py::function::outer") in events
    assert ("call", "scenario.py::function::inner") in events
    assert ("return", "scenario.py::function::inner") in events
    assert trace.status == "ok"


def test_caller_node_id_links_outer_to_inner(repo):
    trace = record_trace(repo, "import scenario; scenario.outer(1)", use_monitoring=False)

    inner_call = next(
        s for s in trace.steps if s.event == "call" and s.node_id.endswith("::inner")
    )
    assert inner_call.caller_node_id == "scenario.py::function::outer"


def test_uncaught_exception_marks_trace_failed_with_error(repo):
    trace = record_trace(repo, "import scenario; scenario.raiser()", use_monitoring=False)

    raises = [s for s in trace.steps if s.event == "raise"]
    assert raises and raises[0].error is not None
    assert raises[0].error.type == "ValueError"
    assert raises[0].error.message == "boom"
    assert trace.status == "failed"


def test_settrace_handled_exception_keeps_status_ok(repo):
    trace = record_trace(repo, "import scenario; scenario.guarded()", use_monitoring=False)

    assert trace.status == "ok"


def test_settrace_handled_exception_marks_error_handled(repo):
    trace = record_trace(repo, "import scenario; scenario.guarded()", use_monitoring=False)

    raises = [s for s in trace.steps if s.event == "raise"]
    assert raises and raises[0].error is not None
    assert raises[0].error.handled is True


def test_clean_sys_exit_is_not_marked_failed(repo):
    trace = record_trace(repo, "import sys; sys.exit(0)", use_monitoring=False)

    assert trace.status == "ok"


def _record_monitoring(repo, cmd):
    try:
        return record_trace(repo, cmd, use_monitoring=True)
    except ValueError:
        pytest.skip("sys.monitoring tool id unavailable in this environment")


def test_monitoring_captures_unwind_path_for_uncaught_exception(repo):
    trace = _record_monitoring(repo, "import scenario; scenario.raiser()")

    unwinds = [s for s in trace.steps if s.event == "unwind"]
    assert any(s.node_id.endswith("::raiser") for s in unwinds)
    assert all(s.error is not None and s.error.type == "ValueError" for s in unwinds)
    assert trace.status == "failed"


def test_monitoring_handled_exception_keeps_status_ok(repo):
    trace = _record_monitoring(repo, "import scenario; scenario.guarded()")

    assert trace.status == "ok"


def test_write_trace_persists_ordered_steps(repo):
    trace = record_trace(repo, "import scenario; scenario.outer(1)", use_monitoring=False)

    out_path = write_trace(repo, trace)
    written = json.loads(out_path.read_text(encoding="utf-8"))
    assert out_path == repo / ".codechroma" / "traces" / f"{trace.id}.json"
    assert written["steps"] == sorted(written["steps"], key=lambda s: s["seq"])
    assert written["steps"]
