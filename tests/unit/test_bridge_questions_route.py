"""Routes for /repos/{id}/questions plus the MCP tool bodies, over a real workspace on disk."""

from __future__ import annotations

import asyncio
import threading
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from codechroma.questions import delivery, store
from codechroma.questions.mcp_server import QuestionAuthError
from codechroma.questions.models import AskRequest, QuestionOption

OPTIONS = [
    QuestionOption(
        id="a", title="Modular monolith", rank=1, description="one deploy", pro="simple",
        con="coupled", why="fits the team",
    ),
    QuestionOption(
        id="b", title="Microservices", rank=2, description="many deploys", pro="isolated",
        con="ops cost", why="scales apart",
    ),
]


def _ask(bridge, **overrides) -> str:
    request = AskRequest(question="How to structure checkout?", options=OPTIONS, **overrides)
    question_id = uuid.uuid4().hex
    store.open_question(bridge.main, request, question_id)
    return question_id


def test_open_question_writes_a_question_element_with_the_documented_meta(bridge):
    question_id = _ask(bridge, session_id="s1", total=3)

    with TestClient(bridge.app) as client:
        elements = client.get("/repos/main/canvas").json()["elements"]

    element = next(e for e in elements.values() if e["render"] == "question")
    assert element["label"] == "How to structure checkout?"
    assert element["meta"]["question_id"] == question_id
    assert element["meta"]["state"] == "open"
    assert (element["meta"]["step"], element["meta"]["total"]) == (1, 3)
    assert element["meta"]["options"][0]["title"] == "Modular monolith"


def test_second_question_in_a_session_gets_the_next_step(bridge):
    _ask(bridge, session_id="s1")
    second = _ask(bridge, session_id="s1")

    element = store.find_element(bridge.main, second)

    assert element.meta["step"] == 2


def test_get_questions_lists_open_ones_as_not_waiting_without_a_live_session(bridge):
    question_id = _ask(bridge)

    with TestClient(bridge.app) as client:
        body = client.get("/repos/main/questions").json()

    assert [q["question_id"] for q in body["questions"]] == [question_id]
    assert body["questions"][0]["waiting"] is False
    assert body["questions"][0]["question"] == "How to structure checkout?"


def test_answer_with_an_option_records_its_title_on_the_element(bridge):
    question_id = _ask(bridge)

    with TestClient(bridge.app) as client:
        response = client.post(
            f"/repos/main/questions/{question_id}/answer", json={"option_id": "a"}
        )
        listed = client.get("/repos/main/questions").json()

    element = store.find_element(bridge.main, question_id)
    assert response.json() == {
        "ok": True, "question_id": question_id, "state": "answered",
        "waiting": False, "answer": "Modular monolith",
    }
    assert element.meta["state"] == "answered"
    assert (element.meta["answer"], element.meta["option_id"]) == ("Modular monolith", "a")
    assert listed["questions"] == []


def test_custom_answer_is_accepted_and_empty_or_unknown_option_is_refused(bridge):
    question_id = _ask(bridge)
    url = f"/repos/main/questions/{question_id}/answer"

    with TestClient(bridge.app) as client:
        empty = client.post(url, json={"answer": "  "})
        unknown = client.post(url, json={"option_id": "zzz"})
        custom = client.post(url, json={"answer": "event sourcing"})

    assert empty.status_code == 422
    assert unknown.status_code == 422
    assert custom.status_code == 200
    assert store.find_element(bridge.main, question_id).meta["answer"] == "event sourcing"


def test_custom_answer_is_refused_when_not_allowed(bridge):
    question_id = _ask(bridge, allow_custom=False)

    with TestClient(bridge.app) as client:
        response = client.post(
            f"/repos/main/questions/{question_id}/answer", json={"answer": "mine"}
        )

    assert response.status_code == 422


def test_skip_marks_the_element_skipped_and_a_second_settle_conflicts(bridge):
    question_id = _ask(bridge)

    with TestClient(bridge.app) as client:
        first = client.post(f"/repos/main/questions/{question_id}/skip")
        again = client.post(f"/repos/main/questions/{question_id}/skip")

    assert first.json()["ok"] is True
    assert again.status_code == 409
    assert store.find_element(bridge.main, question_id).meta["state"] == "skipped"


def test_skip_is_refused_when_not_allowed_and_unknown_question_is_404(bridge):
    question_id = _ask(bridge, allow_skip=False)

    with TestClient(bridge.app) as client:
        refused = client.post(f"/repos/main/questions/{question_id}/skip")
        missing = client.post("/repos/main/questions/nope/skip")

    assert refused.status_code == 422
    assert missing.status_code == 404


class _FakeSession:
    """Stands in for a live PTY agent session; records what was typed into it."""

    def __init__(self, is_alive: bool = True, typed: bool = True, idle: bool = True) -> None:
        self.is_alive = is_alive
        self.typed = typed
        self.idle = threading.Event()
        if idle:
            self.idle.set()
        self.injected: list[tuple[str, int | None]] = []

    def inject_when_idle(self, text, attempts: int | None = None) -> asyncio.Future[bool]:
        if isinstance(text, str):
            self.injected.append((text, attempts))
            typing = asyncio.get_running_loop().create_future()
            typing.set_result(self.typed)
            return typing
        return asyncio.ensure_future(self._type_when_idle(text, attempts))

    async def _type_when_idle(self, build, attempts: int | None) -> bool:
        while not self.idle.is_set():
            await asyncio.sleep(0.01)
        body = await build()
        if body is None:
            return False
        self.injected.append((body, attempts))
        return self.typed

    def close(self) -> None:
        self.is_alive = False


def _eventually(condition, timeout: float = 5.0) -> bool:
    """Polls `condition` while the TestClient loop runs the post-typing follow-up."""
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > deadline:
            return False
        time.sleep(0.01)
    return True


def _typed(session: _FakeSession, count: int = 1) -> bool:
    """Waits for the queued wake-up to type `count` messages into the fake session."""
    return _eventually(lambda: len(session.injected) >= count)


def _live_agent(
    bridge, agent_id: str = "agent-1", typed: bool = True, idle: bool = True
) -> _FakeSession:
    session = _FakeSession(typed=typed, idle=idle)
    bridge.app.state.services.agent_sessions._sessions[agent_id] = session
    return session


def _ask_for(bridge, agent_id: str = "agent-1", **overrides) -> str:
    fields = {"question": "How to structure checkout?", "options": OPTIONS, **overrides}
    request = AskRequest(agent_id=agent_id, **fields)
    question_id = uuid.uuid4().hex
    store.open_question(bridge.main, request, question_id)
    return question_id


def test_ask_returns_at_once_and_tells_the_agent_to_end_its_turn(bridge):
    mcp = bridge.app.state.question_mcp

    result = asyncio.run(mcp.ask("main", AskRequest(question="Pick", options=OPTIONS)))

    element = store.list_questions(bridge.main)[0]
    assert result["asked"] is True
    assert result["question_id"] == element.meta["question_id"]
    assert result["next"].startswith("End your turn")
    assert element.meta["state"] == "open"


def test_answer_types_the_answer_into_the_live_agent_session(bridge):
    session = _live_agent(bridge)
    question_id = _ask_for(bridge, session_id="s1", total=3)

    with TestClient(bridge.app) as client:
        reply = client.post(
            f"/repos/main/questions/{question_id}/answer", json={"option_id": "b"}
        ).json()
        _typed(session)

    assert reply["waiting"] is True
    assert session.injected == [(
        f"[CodeChroma answer · Q1/3 · {question_id}] How to structure checkout? → Microservices",
        86400,
    )]


def test_skip_tells_the_agent_to_decide_itself(bridge):
    session = _live_agent(bridge)
    question_id = _ask_for(bridge)

    with TestClient(bridge.app) as client:
        reply = client.post(f"/repos/main/questions/{question_id}/skip").json()
        _typed(session)

    assert reply["waiting"] is True
    assert session.injected[0][0] == (
        f"[CodeChroma answer · Q1 · {question_id}] How to structure checkout? → "
        "skipped by the user, decide yourself"
    )


def test_answer_after_revise_is_delivered_as_a_changed_answer(bridge):
    session = _live_agent(bridge)
    question_id = _ask_for(bridge, session_id="s1", total=2)
    _ask_for(bridge, session_id="s1", total=2)
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{question_id}/answer", json={"option_id": "a"})
        client.post(f"/repos/main/questions/{question_id}/revise")

        client.post(f"/repos/main/questions/{question_id}/answer", json={"option_id": "b"})
        _typed(session)

    assert len(session.injected) == 1
    assert session.injected[0][0].endswith("→ changed answer: Microservices")


def test_nothing_is_typed_while_another_question_of_the_same_agent_is_open(bridge):
    session = _live_agent(bridge)
    first = _ask_for(bridge)
    _ask_for(bridge, question="Which store?")

    with TestClient(bridge.app) as client:
        reply = client.post(f"/repos/main/questions/{first}/answer", json={"option_id": "a"})

    assert reply.json()["waiting"] is True
    assert session.injected == []
    assert len(store.list_questions(bridge.main)) == 2


def test_settling_the_last_question_types_every_answer_once_into_the_asking_agent(bridge):
    session = _live_agent(bridge)
    first = _ask_for(bridge)
    second = _ask_for(bridge, question="Which store?")
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{first}/answer", json={"option_id": "a"})

        client.post(f"/repos/main/questions/{second}/skip")
        _typed(session)

    assert session.injected == [(
        f"[CodeChroma answer · Q1 · {first}] How to structure checkout? → Modular monolith "
        f"[CodeChroma answer · Q1 · {second}] Which store? → skipped by the user, decide yourself",
        86400,
    )]


def test_another_agents_open_question_neither_blocks_nor_receives_the_wake_up(bridge):
    mine, theirs = _live_agent(bridge, "agent-1"), _live_agent(bridge, "agent-2")
    question_id = _ask_for(bridge, "agent-1")
    other = _ask_for(bridge, "agent-2", question="Which store?")

    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{question_id}/answer", json={"option_id": "a"})
        _eventually(lambda: len(store.list_questions(bridge.main)) == 1)

    assert len(mine.injected) == 1
    assert theirs.injected == []
    assert [e.meta["question_id"] for e in store.list_questions(bridge.main)] == [other]


def test_a_completed_batch_leaves_no_question_or_option_diagram_on_the_canvas(bridge):
    from codechroma.canvas.document import CanvasDoc
    from codechroma.questions import diagrams

    ws = bridge.main
    _live_agent(bridge)
    edge = [diagrams.DiagramEdge(**{"from": "n0", "to": "n1"})]
    draft = store.draw_diagram(ws, "Draft", _nodes(), edge, None, None)
    options = [OPTIONS[0].model_copy(update={"diagram_ref": draft}), OPTIONS[1]]
    question_id = _ask_for(bridge, options=options)
    store.draw_diagram(ws, "Attached", _nodes(), edge, question_id, "b")
    unrelated = store.draw_diagram(ws, "Other draft", _nodes(), [], None, None)

    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{question_id}/answer", json={"option_id": "a"})
        _eventually(lambda: not store.list_questions(ws))

    doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
    assert not [e for e in doc.elements.values() if e.render == "question"]
    assert not [e for e in doc.elements.values() if e.layer == f"decisions/{question_id}"]
    assert not [e for e in doc.edges.values() if e.layer == f"decisions/{question_id}"]
    assert unrelated in doc.elements


def test_a_session_keeps_counting_steps_after_its_answered_batch_is_cleared(bridge):
    _live_agent(bridge)
    first = _ask_for(bridge, session_id="s1", total=3)
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{first}/answer", json={"option_id": "a"})
        _eventually(lambda: not store.list_questions(bridge.main))

        second = _ask_for(bridge, session_id="s1", total=3, question="Which store?")

    assert store.find_element(bridge.main, second).meta["step"] == 2


def test_a_batch_the_agent_never_received_stays_on_the_canvas_for_the_next_wake_up(bridge):
    session = _live_agent(bridge, typed=False)
    question_id = _ask_for(bridge)
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{question_id}/answer", json={"option_id": "a"})
        _typed(session)
        _eventually(lambda: store.claim_batch(bridge.main, "agent-1"))

    element = store.find_element(bridge.main, question_id)
    assert len(session.injected) == 1
    assert element.meta["state"] == "answered"
    assert element.meta[store.AWAITING_DELIVERY] is True


def test_a_failed_cleanup_frees_the_agent_for_the_next_wake_up(bridge, monkeypatch):
    session = _live_agent(bridge)
    question_id = _ask_for(bridge)

    def broken(*_args):
        raise store.QuestionWriteError("disk full")

    monkeypatch.setattr(store, "clear_batch", broken)
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{question_id}/answer", json={"option_id": "a"})
        _typed(session)
        freed = _eventually(lambda: store.claim_batch(bridge.main, "agent-1"))

    assert freed
    assert store.find_element(bridge.main, question_id).meta[store.AWAITING_DELIVERY] is True


def test_a_revise_before_the_agent_idles_types_the_new_answer_only(bridge):
    session = _live_agent(bridge, idle=False)
    question_id = _ask_for(bridge)
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{question_id}/answer", json={"option_id": "a"})
        client.post(f"/repos/main/questions/{question_id}/revise")
        client.post(f"/repos/main/questions/{question_id}/answer", json={"option_id": "b"})

        session.idle.set()
        _typed(session)
        _eventually(lambda: not store.list_questions(bridge.main))

    assert len(session.injected) == 1
    assert session.injected[0][0].endswith("→ changed answer: Microservices")
    assert store.list_questions(bridge.main) == []


def test_a_question_asked_before_the_agent_idles_holds_back_the_earlier_answer(bridge):
    session = _live_agent(bridge, idle=False)
    first = _ask_for(bridge)
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{first}/answer", json={"option_id": "a"})
        second = _ask_for(bridge, question="Which store?")
        session.idle.set()
        _eventually(lambda: not delivery._follow_ups)
        client.post(f"/repos/main/questions/{second}/skip")
        _typed(session)

    assert len(session.injected) == 1
    assert first in session.injected[0][0] and second in session.injected[0][0]


def test_answer_without_a_live_session_is_saved_but_not_waiting(bridge):
    question_id = _ask_for(bridge, agent_id="gone")

    with TestClient(bridge.app) as client:
        reply = client.post(
            f"/repos/main/questions/{question_id}/answer", json={"option_id": "a"}
        ).json()

    assert reply["waiting"] is False
    assert store.find_element(bridge.main, question_id).meta["state"] == "answered"


def test_answer_to_a_dead_session_is_not_delivered(bridge):
    session = _FakeSession(is_alive=False)
    bridge.app.state.services.agent_sessions._sessions["agent-1"] = session
    question_id = _ask_for(bridge)

    with TestClient(bridge.app) as client:
        reply = client.post(
            f"/repos/main/questions/{question_id}/answer", json={"option_id": "a"}
        ).json()

    assert reply["waiting"] is False
    assert session.injected == []


def test_get_questions_reports_waiting_while_a_live_session_will_receive_it(bridge):
    _live_agent(bridge)
    live = _ask_for(bridge)
    orphan = _ask_for(bridge, agent_id="gone")

    with TestClient(bridge.app) as client:
        listed = client.get("/repos/main/questions").json()["questions"]

    assert {q["question_id"]: q["waiting"] for q in listed} == {live: True, orphan: False}


def test_answer_message_is_one_line_even_for_a_multiline_custom_answer(bridge):
    session = _live_agent(bridge)
    question_id = _ask_for(bridge)

    with TestClient(bridge.app) as client:
        client.post(
            f"/repos/main/questions/{question_id}/answer", json={"answer": "a\nb\x1b[31m c"}
        )
        _typed(session)

    text = session.injected[0][0]
    assert "\n" not in text and "\x1b" not in text
    assert text.endswith("→ a b [31m c")


def test_result_reads_a_settled_answer_from_the_element(bridge):
    mcp = bridge.app.state.question_mcp
    question_id = _ask(bridge)
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{question_id}/skip")

    result = asyncio.run(mcp.result("main", question_id))

    assert result == {"answer": None, "option_id": None, "skipped": True}


def test_result_is_pending_while_the_question_is_open(bridge):
    mcp = bridge.app.state.question_mcp
    question_id = _ask(bridge)

    result = asyncio.run(mcp.result("main", question_id))

    assert result == {"pending": True, "question_id": question_id}


def test_token_names_its_workspace_and_a_forged_one_is_refused(bridge):
    mcp = bridge.app.state.question_mcp

    token = mcp.token_for("main")

    assert mcp.workspace_id_for(token) == "main"
    for forged in (token + "0", "main.deadbeef", "", None):
        with pytest.raises(QuestionAuthError):
            mcp.workspace_id_for(forged)


def test_revise_reopens_the_question_and_deletes_later_steps_of_its_session(bridge):
    first = _ask(bridge, session_id="s1")
    second = _ask(bridge, session_id="s1")
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{first}/answer", json={"option_id": "a"})
        client.post(f"/repos/main/questions/{second}/answer", json={"option_id": "b"})

        response = client.post(f"/repos/main/questions/{first}/revise")

    reopened = store.find_element(bridge.main, first)
    assert response.json()["state"] == "open"
    assert len(response.json()["removed"]) == 1
    assert reopened.meta["state"] == "open"
    assert reopened.meta["answer"] is None
    assert store.find_element(bridge.main, second) is None
    assert reopened.layer == "questions"


def test_request_diagram_marks_the_element_and_counts_the_request(bridge):
    question_id = _ask(bridge)

    with TestClient(bridge.app) as client:
        response = client.post(f"/repos/main/questions/{question_id}/request-diagram")

    meta = store.find_element(bridge.main, question_id).meta
    assert response.json()["state"] == "open"
    assert meta["diagram_requested"] is True
    assert meta["diagram_requests"] == 1
    assert meta["diagram_requested_at"]


def test_request_diagram_is_refused_when_every_option_has_a_diagram(bridge):
    options = [o.model_copy(update={"diagram_ref": "x"}) for o in OPTIONS]
    question_id = uuid.uuid4().hex
    store.open_question(bridge.main, AskRequest(question="Q?", options=options), question_id)

    with TestClient(bridge.app) as client:
        response = client.post(f"/repos/main/questions/{question_id}/request-diagram")

    assert response.status_code == 422


def test_request_diagram_types_a_request_into_the_live_agent_session(bridge):
    session = _live_agent(bridge)
    question_id = _ask_for(bridge)

    with TestClient(bridge.app) as client:
        reply = client.post(f"/repos/main/questions/{question_id}/request-diagram").json()

    assert reply["waiting"] is True
    assert session.injected[0][0].startswith(f"[CodeChroma request · Q1 · {question_id}]")
    assert "draw_option_diagram" in session.injected[0][0]


def test_repeated_request_diagram_clicks_count_once_and_report_no_session(bridge):
    question_id = _ask(bridge)
    url = f"/repos/main/questions/{question_id}/request-diagram"

    with TestClient(bridge.app) as client:
        first = client.post(url).json()
        second = client.post(url).json()

    meta = store.find_element(bridge.main, question_id).meta
    assert meta["diagram_requests"] == 1
    assert first["waiting"] is False
    assert second["waiting"] is False


def test_find_diagram_requested_returns_the_newest_card_and_its_older_duplicates(bridge):
    old = _ask(bridge, session_id="s1")
    new = _ask(bridge, session_id="s1")
    for qid in (old, new):
        store.request_diagram(bridge.main, store.find_element(bridge.main, qid), "now")
    request = AskRequest(question="How to structure checkout?", options=OPTIONS, session_id="s1")

    keep, stale = store.find_diagram_requested(bridge.main, request)

    assert keep.meta["question_id"] == new
    assert [e.meta["question_id"] for e in stale] == [old]


def test_reask_skips_stale_duplicates_and_refreshes_label_and_meta(bridge):
    old = _ask(bridge, session_id="s1")
    new = _ask(bridge, session_id="s1")
    for qid in (old, new):
        store.request_diagram(bridge.main, store.find_element(bridge.main, qid), "now")
    store.reask(
        bridge.main, store.find_element(bridge.main, new), AskRequest(question="Q1?"),
        {"degraded": True, "validation": "bad"},
    )
    request = AskRequest(question="Reworded?", options=OPTIONS, session_id="s1")

    store.reask(
        bridge.main, store.find_element(bridge.main, new), request, None,
        [store.find_element(bridge.main, old)],
    )

    element = store.find_element(bridge.main, new)
    assert element.label == "Reworded?"
    assert element.meta["degraded"] is False
    assert element.meta["validation"] is None
    assert store.find_element(bridge.main, old).meta["state"] == "skipped"


def test_ask_stamps_the_authenticated_workspace_as_agent_id(bridge):
    mcp = bridge.app.state.question_mcp

    asyncio.run(mcp.ask("main", AskRequest(question="Pick", options=OPTIONS, agent_id="spoofed")))

    assert store.list_questions(bridge.main)[0].meta["agent_id"] == "main"


def test_reask_keeps_the_question_id_and_returns_it(bridge):
    mcp = bridge.app.state.question_mcp
    question_id = _ask(bridge, session_id="s1")
    store.request_diagram(bridge.main, store.find_element(bridge.main, question_id), "now")

    result = asyncio.run(
        mcp.ask("main", AskRequest(question="Again?", options=OPTIONS, session_id="s1"))
    )

    assert result["question_id"] == question_id
    assert len(store.list_questions(bridge.main)) == 1


def _doc(bridge):
    from codechroma.canvas.document import CanvasDoc

    return CanvasDoc.load(bridge.main.canvas_core_path, bridge.main.diagrams_root)


def _nodes(count: int = 2):
    from codechroma.questions import diagrams

    return [diagrams.DiagramNode(id=f"n{i}", label=f"n{i}") for i in range(count)]


def test_draw_diagram_places_a_new_diagram_below_every_existing_decision_element(bridge):
    ws = bridge.main
    roots = [store.draw_diagram(ws, "T", _nodes(), [], None, None) for _ in range(2)]
    store._commit(ws, lambda _doc: [{"op": "delete_element", "id": roots[0]}])

    third = store.draw_diagram(ws, "T", _nodes(), [], None, None)

    doc = _doc(bridge)
    previous, new = doc.elements[roots[1]], doc.elements[third]
    assert new.position.y - new.size.h / 2 > previous.position.y + previous.size.h / 2


def test_draw_diagram_writes_centre_positions_and_a_root_sized_to_its_members(bridge):
    root = store.draw_diagram(bridge.main, "T", _nodes(5), [], None, None)

    doc = _doc(bridge)
    group = doc.elements[root]
    members = [e for e in doc.elements.values() if e.group_id == root]
    assert len(members) == 5
    for m in members:
        assert abs(m.position.x - group.position.x) <= group.size.w / 2 - m.size.w / 2
        assert abs(m.position.y - group.position.y) <= group.size.h / 2 - m.size.h / 2
    assert group.position.x - group.size.w / 2 == 0


def test_draw_diagram_with_a_question_id_uses_that_questions_layer_for_every_option(bridge):
    question_id = _ask(bridge)
    first = store.draw_diagram(bridge.main, "A", _nodes(), [], question_id, "a")
    second = store.draw_diagram(bridge.main, "B", _nodes(), [], question_id, "b")

    doc = _doc(bridge)
    layers = {e.layer for e in doc.elements.values() if e.meta.get("diagram_root") or e.group_id}
    options = store.find_element(bridge.main, question_id).meta["options"]
    assert layers == {f"decisions/{question_id}"}
    assert {o["id"]: o["diagram_ref"] for o in options} == {"a": first, "b": second}


def test_asking_adopts_draft_diagrams_onto_the_new_question_layer(bridge):
    from codechroma.questions import diagrams

    ws = bridge.main
    edge = [diagrams.DiagramEdge(**{"from": "n0", "to": "n1"})]
    root = store.draw_diagram(ws, "A", _nodes(), edge, None, None)
    assert _doc(bridge).elements[root].layer.startswith("decisions/draft-")
    options = [OPTIONS[0].model_copy(update={"diagram_ref": root}), OPTIONS[1]]
    question_id = uuid.uuid4().hex

    store.open_question(ws, AskRequest(question="Q?", options=options), question_id)

    doc = _doc(bridge)
    wanted = f"decisions/{question_id}"
    assert doc.elements[root].layer == wanted
    assert {e.layer for e in doc.elements.values() if e.group_id == root} == {wanted}
    assert {e.layer for e in doc.edges.values()} == {wanted}


def test_decision_layers_are_saved_in_canvas_core_with_no_projection_file(bridge):
    question_id = _ask(bridge)
    store.draw_diagram(bridge.main, "A", _nodes(), [], question_id, "a")

    core = bridge.main.canvas_core_path.read_text(encoding="utf-8")

    assert f"decisions/{question_id}" in core
    assert not list(bridge.main.diagrams_root.glob("**/projection.json"))


def test_draw_diagram_with_an_unknown_option_leaves_no_orphan_diagram(bridge):
    question_id = _ask(bridge)

    with pytest.raises(store.QuestionWriteError):
        store.draw_diagram(bridge.main, "T", _nodes(1), [], question_id, "nope")

    assert not [e for e in _doc(bridge).elements.values() if e.meta.get("diagram_root")]


def test_draw_option_diagram_warns_when_most_nodes_lack_a_description(bridge):
    from codechroma.questions import diagrams

    mcp = bridge.app.state.question_mcp
    plain = _nodes(3)
    described = [diagrams.DiagramNode(id=n.id, label=n.label, description="adds X") for n in plain]

    warned = asyncio.run(mcp.draw_diagram("main", "T", plain, [], None, None))
    clean = asyncio.run(mcp.draw_diagram("main", "T", described, [], None, None))

    assert "description" in warned["warning"]
    assert list(clean) == ["diagram_ref"]


def test_draw_diagram_stacks_under_its_own_question_not_the_lowest_diagram_on_the_canvas(bridge):
    ws = bridge.main
    first, second = _ask(bridge), _ask(bridge)
    a = store.draw_diagram(ws, "A", _nodes(), [], first, "a")
    far = store.draw_diagram(ws, "Far", _nodes(), [], second, "a")
    move = {"op": "update_element", "id": far, "position": {"x": 0, "y": 5000}}
    store._commit(ws, lambda _doc: [move])

    b = store.draw_diagram(ws, "B", _nodes(), [], first, "b")

    doc = _doc(bridge)
    assert doc.elements[b].position.y < doc.elements[far].position.y
    assert doc.elements[b].position.y > doc.elements[a].position.y


def test_asking_prunes_unadopted_draft_diagrams_older_than_the_ttl(bridge):
    ws = bridge.main
    stale = store.draw_diagram(ws, "Old", _nodes(), [], None, None)
    fresh = store.draw_diagram(ws, "New", _nodes(), [], None, None)
    store._commit(ws, lambda _doc: [{"op": "update_element", "id": stale, "meta": {"drawn_at": 1}}])

    _ask(bridge)

    doc = _doc(bridge)
    assert stale not in doc.elements
    assert not [e for e in doc.elements.values() if e.group_id == stale]
    assert fresh in doc.elements


def test_reasking_clears_the_revised_flag(bridge):
    question_id = _ask(bridge)
    element = store.find_element(bridge.main, question_id)
    store.reopen(bridge.main, element)
    reopened = store.find_element(bridge.main, question_id)

    store.reask(bridge.main, reopened, AskRequest(question="Q?", options=OPTIONS), None)

    assert store.find_element(bridge.main, question_id).meta["revised"] is False


def test_find_diagram_requested_ignores_an_unrelated_ask_from_another_session(bridge):
    question_id = _ask(bridge, session_id="s1")
    store.request_diagram(bridge.main, store.find_element(bridge.main, question_id), "now")
    other = AskRequest(question="Unrelated?", options=OPTIONS, session_id="s2")

    assert store.find_diagram_requested(bridge.main, other) is None


def test_find_diagram_requested_ignores_a_different_text_without_session(bridge):
    question_id = _ask(bridge)
    store.request_diagram(bridge.main, store.find_element(bridge.main, question_id), "now")

    assert store.find_diagram_requested(bridge.main, AskRequest(question="Other?")) is None
