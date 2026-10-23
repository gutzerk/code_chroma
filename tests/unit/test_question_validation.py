"""The `ask_user` contract: each rule, the rejection text, the retry counter and the fallback."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from codechroma.canvas.document import CanvasDoc
from codechroma.questions import diagrams, store
from codechroma.questions.mcp_server import QuestionMcp
from codechroma.questions.models import AskRequest, QuestionOption
from codechroma.questions.validation import (
    QuestionRejected,
    RejectionTracker,
    rejection_text,
    unknown_refs,
    validate_ask,
)


def _fast(monkeypatch, wait: float) -> None:
    fake = SimpleNamespace(questions=SimpleNamespace(ask_wait_seconds=wait, max_rejections=3))
    monkeypatch.setattr("codechroma.questions.mcp_server.settings", fake)


def _option(option_id: str, rank: int | None = None, **overrides) -> QuestionOption:
    fields = {
        "title": f"Option {option_id}", "description": "d", "pro": "p", "con": "c", "why": "w",
    }
    return QuestionOption(id=option_id, rank=rank, **{**fields, **overrides})


def _request(options=None, **overrides) -> AskRequest:
    options = options if options is not None else [_option("a", 1), _option("b", 2)]
    return AskRequest(question="Which way?", options=options, **overrides)


def _node(node_id: str, **overrides) -> diagrams.DiagramNode:
    return diagrams.DiagramNode(id=node_id, label=overrides.pop("label", node_id), **overrides)


def _mcp(bridge) -> QuestionMcp:
    return bridge.app.state.question_mcp


def test_a_complete_question_has_no_problems():
    assert validate_ask(_request()) == []


@pytest.mark.parametrize("missing", ["description", "pro", "con", "why", "title"])
def test_an_option_missing_a_field_is_named(missing):
    request = _request([_option("a", 1), _option("b", 2, **{missing: ""})])

    problems = validate_ask(request)

    assert len(problems) == 1
    assert f"missing {missing}" in problems[0]


def test_no_rank_one_is_reported():
    problems = validate_ask(_request([_option("a", 2), _option("b", 3)]))

    assert "exactly one option must have rank 1" in problems


def test_two_rank_ones_are_reported():
    problems = validate_ask(_request([_option("a", 1), _option("b", 1)]))

    assert "exactly one option must have rank 1" in problems
    assert "ranks are not unique" in problems


@pytest.mark.parametrize("count", [1, 5])
def test_option_count_outside_two_to_four_is_reported(count):
    options = [_option(str(i), 1 if i == 0 else i + 1) for i in range(count)]

    problems = validate_ask(_request(options))

    assert any("2-4 options" in p for p in problems)


def test_duplicate_option_ids_are_reported():
    problems = validate_ask(_request([_option("a", 1), _option("a", 2)]))

    assert "option ids are not unique" in problems


def test_an_empty_question_is_reported():
    request = _request()
    request.question = " "

    assert "question is empty" in validate_ask(request)


def test_a_diagram_question_needs_one_diagram_ref():
    problems = validate_ask(_request(kind="diagram"))

    assert any("diagram_ref" in p for p in problems)


def test_a_diagram_question_with_a_ref_passes():
    request = _request([_option("a", 1, diagram_ref="x"), _option("b", 2)], kind="diagram")

    assert validate_ask(request) == []


def test_unknown_diagram_refs_are_listed():
    request = _request([_option("a", 1, diagram_ref="nope"), _option("b", 2)])

    assert len(unknown_refs(request, {"other"})) == 1
    assert unknown_refs(request, {"nope"}) == []


def test_rejection_text_has_header_bullets_and_footer():
    text = rejection_text(['Option "B": missing con', "exactly one option must have rank 1"])

    lines = text.splitlines()
    assert lines[0] == "CodeChroma rejected the question."
    assert lines[1:3] == ['- Option "B": missing con', "- exactly one option must have rank 1"]
    assert lines[3].startswith("Call ask_user again with all fields.")


def test_tracker_counts_and_resets():
    tracker = RejectionTracker()
    tracker.record("w", "s")
    tracker.record("w", "s")

    assert tracker.count("w", "s") == 2
    tracker.reset("w", "s")
    assert tracker.count("w", "s") == 0


def test_tracker_forgets_after_ten_minutes_of_silence():
    now = [0.0]
    tracker = RejectionTracker(clock=lambda: now[0])
    tracker.record("w", "s")

    now[0] = 601.0

    assert tracker.count("w", "s") == 0


def test_tracker_does_not_track_a_missing_session():
    tracker = RejectionTracker()

    tracker.record("w", None)

    assert tracker.count("w", None) == 0


def test_tracker_evicts_stale_entries_and_caps_size():
    now = [0.0]
    tracker = RejectionTracker(clock=lambda: now[0], max_entries=2)
    tracker.record("w", "old")
    now[0] = 700.0
    tracker.record("w", "a")
    tracker.record("w", "b")
    tracker.record("w", "c")

    assert len(tracker._entries) == 2
    assert tracker.count("w", "c") == 1
    assert tracker.count("w", "old") == 0


def test_degraded_pass_through_consumes_the_count(bridge, monkeypatch):
    _fast(monkeypatch, 0.05)
    mcp = _mcp(bridge)
    bad = AskRequest(question="Q?", session_id="s", options=[QuestionOption(id="a", title="A")])

    async def run() -> None:
        for _ in range(3):
            with pytest.raises(QuestionRejected):
                await mcp.ask("main", bad)
        await mcp.ask("main", bad)
        with pytest.raises(QuestionRejected):
            await mcp.ask("main", bad)

    asyncio.run(run())

    assert mcp.rejections.count("main", "s") == 1


def test_sessionless_agents_on_different_connections_do_not_share_a_counter(bridge, monkeypatch):
    _fast(monkeypatch, 0.05)
    mcp = _mcp(bridge)
    bad = AskRequest(question="Q?", options=[QuestionOption(id="a", title="A")])

    async def run() -> None:
        for _ in range(3):
            with pytest.raises(QuestionRejected):
                await mcp.ask("main", bad, connection="A")
        with pytest.raises(QuestionRejected):
            await mcp.ask("main", bad, connection="B")

    asyncio.run(run())

    assert mcp.rejections.count("main", "conn:A") == 3
    assert mcp.rejections.count("main", "conn:B") == 1


def test_incomplete_ask_is_rejected_with_the_tool_error(bridge):
    request = AskRequest(question="Q?", options=[QuestionOption(id="a", title="A")] * 2)

    with pytest.raises(QuestionRejected) as caught:
        asyncio.run(_mcp(bridge).ask("main", request))

    assert str(caught.value).startswith("CodeChroma rejected the question.")
    assert store.list_questions(bridge.main) == []


def test_fourth_incomplete_ask_is_accepted_degraded(bridge, monkeypatch):
    _fast(monkeypatch, 0.05)
    request = AskRequest(question="Q?", session_id="s", options=[QuestionOption(id="a", title="A")])

    async def run() -> None:
        for _ in range(3):
            with pytest.raises(QuestionRejected):
                await _mcp(bridge).ask("main", request)
        await _mcp(bridge).ask("main", request)

    asyncio.run(run())

    element = store.list_questions(bridge.main)[0]
    assert element.meta["degraded"] is True
    assert element.meta["validation"].startswith("CodeChroma rejected the question.")


def test_ask_with_an_unknown_diagram_ref_is_rejected(bridge):
    request = _request([_option("a", 1, diagram_ref="ghost"), _option("b", 2)])

    with pytest.raises(QuestionRejected) as caught:
        asyncio.run(_mcp(bridge).ask("main", request))

    assert "ghost" in str(caught.value)


def test_draw_diagram_returns_a_ref_that_a_diagram_question_accepts(bridge, monkeypatch):
    _fast(monkeypatch, 0.05)
    nodes = [_node("api"), _node("q", status="new")]
    edges = [diagrams.DiagramEdge(**{"from": "api", "to": "q"})]

    async def run() -> dict:
        drawn = await _mcp(bridge).draw_diagram("main", "Option A", nodes, edges, None, None)
        options = [_option("a", 1, diagram_ref=drawn["diagram_ref"]), _option("b", 2)]
        return await _mcp(bridge).ask("main", _request(options, kind="diagram"))

    result = asyncio.run(run())

    assert result["pending"] is True


def test_draw_diagram_writes_nodes_on_the_decisions_layer_under_one_root(bridge):
    nodes = [_node("a", status="new"), _node("b")]
    edges = [diagrams.DiagramEdge(**{"from": "a", "to": "b"})]

    root = asyncio.run(_mcp(bridge).draw_diagram("main", "T", nodes, edges, None, None))

    doc = CanvasDoc.load(bridge.main.canvas_core_path, bridge.main.diagrams_root)
    members = [e for e in doc.elements.values() if e.group_id == root["diagram_ref"]]
    assert {e.layer for e in members} == {"decisions"}
    assert sorted(e.label for e in members) == ["a", "b"]
    assert [e.meta.get("status") for e in members if e.label == "a"] == ["new"]
    assert len(doc.edges) == 1


def test_draw_diagram_over_the_node_budget_is_rejected(bridge):
    nodes = [_node(str(i)) for i in range(diagrams.MAX_NODES + 1)]

    with pytest.raises(QuestionRejected):
        asyncio.run(_mcp(bridge).draw_diagram("main", "T", nodes, [], None, None))


def test_draw_diagram_with_an_empty_title_is_rejected(bridge):
    nodes = [_node("a")]

    with pytest.raises(QuestionRejected, match="title is empty"):
        asyncio.run(_mcp(bridge).draw_diagram("main", "  ", nodes, [], None, None))


def test_draw_diagram_attaches_the_ref_to_the_question_option(bridge):
    store.open_question(bridge.main, _request(), "q1")

    root = asyncio.run(_mcp(bridge).draw_diagram("main", "T", [_node("a")], [], "q1", "b"))

    options = store.find_element(bridge.main, "q1").meta["options"]
    assert [o["diagram_ref"] for o in options] == [None, root["diagram_ref"]]


def test_request_diagram_wakes_the_blocked_ask_with_needs(bridge, monkeypatch):
    _fast(monkeypatch, 5)
    mcp = _mcp(bridge)

    async def run() -> dict:
        task = asyncio.create_task(mcp.ask("main", _request(session_id="s")))
        await asyncio.sleep(0.2)
        question_id = store.list_questions(bridge.main)[0].meta["question_id"]
        mcp.broker.request_diagram(question_id)
        return await task

    result = asyncio.run(run())

    assert result["needs"] == "diagram"


def test_reask_after_a_diagram_request_updates_the_same_element(bridge, monkeypatch):
    _fast(monkeypatch, 0.05)
    mcp = _mcp(bridge)
    asyncio.run(mcp.ask("main", _request(session_id="s")))
    element = store.list_questions(bridge.main)[0]
    store.request_diagram(bridge.main, element, "now")
    drawn = asyncio.run(mcp.draw_diagram("main", "T", [_node("a")], [], None, None))
    options = [_option("a", 1, diagram_ref=drawn["diagram_ref"]), _option("b", 2)]

    asyncio.run(mcp.ask("main", _request(options, session_id="s", kind="diagram")))

    questions = store.list_questions(bridge.main)
    assert [q.id for q in questions] == [element.id]
    assert questions[0].meta["options"][0]["diagram_ref"] == drawn["diagram_ref"]
    assert questions[0].meta["diagram_requested"] is False


def _load_checker():
    import importlib.util

    from codechroma.bridge.resources import resource_path

    path = resource_path("skills") / "codechroma-decision-diagram" / "scripts"
    script = path / "check_decision_diagram.py"
    spec = importlib.util.spec_from_file_location("check_decision_diagram", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_decision_diagram_checker_accepts_a_draft_within_budget():
    checker = _load_checker()
    draft = {"title": "A", "nodes": [{"id": "x", "label": "X"}], "edges": []}

    assert checker.problems(draft) == []


def test_decision_diagram_checker_reports_budget_and_unknown_edges():
    checker = _load_checker()
    nodes = [{"id": str(i), "label": "n"} for i in range(checker.MAX_NODES + 1)]
    draft = {"title": "A", "nodes": nodes, "edges": [{"from": "0", "to": "zz"}]}

    found = checker.problems(draft)

    assert len(found) == 2


_PARITY_DRAFTS = {
    "empty_title": {"title": " ", "nodes": [{"id": "a", "label": "A"}], "edges": []},
    "long_title": {"title": "t" * 81, "nodes": [{"id": "a", "label": "A"}], "edges": []},
    "long_id": {"title": "T", "nodes": [{"id": "a" * 41, "label": "A"}], "edges": []},
    "empty_id": {"title": "T", "nodes": [{"id": " ", "label": "A"}], "edges": []},
    "long_label": {"title": "T", "nodes": [{"id": "a", "label": "l" * 61}], "edges": []},
    "long_description": {
        "title": "T", "nodes": [{"id": "a", "label": "A", "description": "d" * 301}], "edges": [],
    },
    "self_loop": {
        "title": "T", "nodes": [{"id": "a", "label": "A"}],
        "edges": [{"from": "a", "to": "a"}],
    },
    "duplicate_edge": {
        "title": "T", "nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
        "edges": [{"from": "a", "to": "b"}, {"from": "a", "to": "b"}],
    },
    "unknown_edge_and_dup_ids": {
        "title": "T", "nodes": [{"id": "a", "label": "A"}, {"id": "a", "label": ""}],
        "edges": [{"from": "a", "to": "zz"}],
    },
    "no_nodes": {"title": "T", "nodes": [], "edges": []},
    "clean": {"title": "T", "nodes": [{"id": "a", "label": "A"}], "edges": []},
}


@pytest.mark.parametrize("name", sorted(_PARITY_DRAFTS))
def test_server_diagram_validator_matches_the_skill_checker(name):
    from codechroma.questions import diagrams

    draft = _PARITY_DRAFTS[name]
    nodes = [diagrams.DiagramNode(**n) for n in draft["nodes"]]
    edges = [diagrams.DiagramEdge(**e) for e in draft["edges"]]

    server = diagrams.validate_diagram(nodes, edges, draft["title"])

    assert server == _load_checker().problems(draft)
    assert bool(server) == (name != "clean")
