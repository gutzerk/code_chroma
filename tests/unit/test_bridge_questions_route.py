"""Routes for /repos/{id}/questions plus the MCP tool bodies, over a real workspace on disk."""

from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from codechroma.questions import store
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


def test_get_questions_lists_open_ones_as_not_waiting_without_a_live_waiter(bridge):
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


def test_answer_route_wakes_a_blocked_ask(bridge):
    mcp = bridge.app.state.question_mcp
    client = TestClient(bridge.app)

    async def scenario():
        task = asyncio.create_task(mcp.ask("main", AskRequest(question="Pick", options=OPTIONS)))
        open_now: list = []
        for _ in range(300):
            await asyncio.sleep(0.01)
            open_now = await asyncio.to_thread(store.list_questions, bridge.main)
            if open_now and mcp.broker.is_waiting(open_now[0].meta["question_id"]):
                break
        url = f"/repos/main/questions/{open_now[0].meta['question_id']}/answer"
        reply = await asyncio.to_thread(client.post, url, json={"option_id": "b"})
        return reply.json(), await asyncio.wait_for(task, 5)

    reply, result = asyncio.run(scenario())

    assert reply["waiting"] is True
    assert reply["state"] == "answered"
    assert result == {"answer": "Microservices", "option_id": "b", "skipped": False}


def test_ask_returns_pending_on_timeout_and_result_fetches_the_later_answer(bridge, monkeypatch):
    fast = SimpleNamespace(questions=SimpleNamespace(ask_wait_seconds=0.05, max_rejections=3))
    monkeypatch.setattr("codechroma.questions.mcp_server.settings", fast)
    mcp = bridge.app.state.question_mcp

    async def scenario():
        pending = await mcp.ask("main", AskRequest(question="Pick", options=OPTIONS))
        mcp.broker.answer(pending["question_id"], "late", None)
        return pending, await mcp.result("main", pending["question_id"])

    pending, later = asyncio.run(scenario())

    assert pending["pending"] is True
    assert later == {"answer": "late", "option_id": None, "skipped": False}


def test_result_reads_the_element_when_the_broker_forgot_it(bridge):
    mcp = bridge.app.state.question_mcp
    question_id = _ask(bridge)
    with TestClient(bridge.app) as client:
        client.post(f"/repos/main/questions/{question_id}/skip")
    mcp.broker._results.clear()

    result = asyncio.run(mcp.result("main", question_id))

    assert result == {"answer": None, "option_id": None, "skipped": True}


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


def test_request_diagram_hands_needs_to_the_blocked_ask(bridge):
    mcp = bridge.app.state.question_mcp

    async def scenario():
        task = asyncio.create_task(mcp.ask("main", AskRequest(question="Pick", options=OPTIONS)))
        await asyncio.sleep(0.2)
        question_id = store.list_questions(bridge.main)[0].meta["question_id"]
        url = f"/repos/main/questions/{question_id}/request-diagram"
        await asyncio.to_thread(lambda: TestClient(bridge.app).post(url))
        return question_id, await task

    question_id, result = asyncio.run(scenario())

    assert result == {"needs": "diagram", "question_id": question_id}


def test_repeated_request_diagram_clicks_count_once_and_report_no_waiter(bridge):
    question_id = _ask(bridge)
    url = f"/repos/main/questions/{question_id}/request-diagram"

    with TestClient(bridge.app) as client:
        first = client.post(url).json()
        second = client.post(url).json()

    meta = store.find_element(bridge.main, question_id).meta
    assert meta["diagram_requests"] == 1
    assert first["waiting"] is False
    assert second["waiting"] is False


def test_find_diagram_requested_ignores_an_unrelated_ask_from_another_session(bridge):
    question_id = _ask(bridge, session_id="s1")
    store.request_diagram(bridge.main, store.find_element(bridge.main, question_id), "now")
    other = AskRequest(question="Unrelated?", options=OPTIONS, session_id="s2")

    assert store.find_diagram_requested(bridge.main, other) is None


def test_find_diagram_requested_ignores_a_different_text_without_session(bridge):
    question_id = _ask(bridge)
    store.request_diagram(bridge.main, store.find_element(bridge.main, question_id), "now")

    assert store.find_diagram_requested(bridge.main, AskRequest(question="Other?")) is None


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

    async def scenario():
        task = asyncio.create_task(
            mcp.ask("main", AskRequest(question="Pick", options=OPTIONS, agent_id="spoofed"))
        )
        await asyncio.sleep(0.2)
        task.cancel()

    asyncio.run(scenario())

    assert store.list_questions(bridge.main)[0].meta["agent_id"] == "main"


def test_draw_diagram_bands_do_not_overlap_after_a_diagram_is_deleted(bridge):
    from codechroma.canvas.document import CanvasDoc
    from codechroma.questions import diagrams

    nodes = [diagrams.DiagramNode(id="a", label="a")]
    roots = [store.draw_diagram(bridge.main, "T", nodes, [], None, None) for _ in range(2)]
    ws = bridge.main
    store._commit(ws, lambda _doc: [{"op": "delete_element", "id": roots[0]}])

    third = store.draw_diagram(ws, "T", nodes, [], None, None)

    doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
    assert doc.elements[third].position.y > doc.elements[roots[1]].position.y


def test_draw_diagram_with_an_unknown_option_leaves_no_orphan_diagram(bridge):
    from codechroma.canvas.document import CanvasDoc
    from codechroma.questions import diagrams

    question_id = _ask(bridge)
    nodes = [diagrams.DiagramNode(id="a", label="a")]

    with pytest.raises(store.QuestionWriteError):
        store.draw_diagram(bridge.main, "T", nodes, [], question_id, "nope")

    doc = CanvasDoc.load(bridge.main.canvas_core_path, bridge.main.diagrams_root)
    assert not [e for e in doc.elements.values() if e.meta.get("diagram_root")]
