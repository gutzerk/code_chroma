"""The agent window's source: /agents/{id}/questions, `agent-questions` and `open_questions`."""

from __future__ import annotations

import asyncio
import uuid

from fastapi.testclient import TestClient

from codechroma.questions import diagrams, store
from codechroma.questions.agent_view import AGENT_QUESTIONS_EVENT, announce
from codechroma.questions.mcp_server import QuestionMcp
from codechroma.questions.models import AskRequest, QuestionOption

OPTIONS = [
    QuestionOption(id="a", title="Modular monolith", rank=1, description="d", pro="p", con="c",
                   why="w"),
    QuestionOption(id="b", title="Microservices", rank=2, description="d", pro="p", con="c",
                   why="w"),
]


def _agent_on_tab(client: TestClient, title: str = "Looker") -> tuple[str, str]:
    """A shell agent on the ensured tab, so it shares the tab's workspace; returns (tab, agent)."""
    tab = client.post("/branches/ensure").json()["active"]
    agent = client.post("/agents", json={"title": title, "kind": "shell", "workspace": tab}).json()
    return tab, agent["id"]


def _ask(bridge, agent_id: str, into: str | None = None, **overrides) -> str:
    """Opens a question as `agent_id` in the workspace `into` (default: the agent's) asks into."""
    fields = {"question": "Now?", "options": OPTIONS, "agent_id": agent_id, **overrides}
    request = AskRequest(**fields)
    question_id = uuid.uuid4().hex
    store.open_question(bridge.registry.get(into or agent_id), request, question_id)
    return question_id


def test_reads_the_agents_question_history_and_option_diagram_from_the_workspace_it_shares(bridge):
    with TestClient(bridge.app) as client:
        tab, agent = _agent_on_tab(client)
        earlier = _ask(bridge, agent, question="Earlier?", session_id="s1")
        client.post(f"/repos/{tab}/questions/{earlier}/answer", json={"option_id": "a"})
        current = _ask(bridge, agent, session_id="s1")
        _ask(bridge, "someone-else", into=agent, question="Not mine?")
        nodes = [
            diagrams.DiagramNode(id="api", label="API"), diagrams.DiagramNode(id="db", label="DB")
        ]
        edge = diagrams.DiagramEdge.model_validate({"from": "api", "to": "db"})
        root = store.draw_diagram(bridge.registry.get(agent), "A", nodes, [edge], current, "a")

        body = client.get(f"/agents/{agent}/questions").json()

    labels = [e["label"] for e in body["elements"].values()]
    assert (body["agent_id"], body["workspace"], body["open_questions"]) == (agent, tab, 1)
    assert {"Now?", "Earlier?", "API"} <= set(labels)
    assert "Not mine?" not in labels
    assert root in body["elements"]
    assert len(body["edges"]) == 1


def test_a_neighbours_settled_question_in_the_same_session_is_not_in_the_history(bridge):
    with TestClient(bridge.app) as client:
        tab, agent = _agent_on_tab(client)
        theirs = _ask(
            bridge, "someone-else", into=agent, question="Their earlier?", session_id="s1"
        )
        client.post(f"/repos/{tab}/questions/{theirs}/answer", json={"option_id": "a"})
        _ask(bridge, agent, session_id="s1")

        body = client.get(f"/agents/{agent}/questions").json()

    assert [e["label"] for e in body["elements"].values()] == ["Now?"]


def test_a_new_agent_that_reuses_a_closed_agents_id_starts_without_its_questions(bridge):
    with TestClient(bridge.app) as client:
        _, closed = _agent_on_tab(client)
        asked = _ask(bridge, closed, question="Old open?", session_id="s1")
        nodes = [diagrams.DiagramNode(id="api", label="API")]
        store.draw_diagram(bridge.registry.get(closed), "A", nodes, [], asked, "a")
        client.delete(f"/agents/{closed}")

        _, reused = _agent_on_tab(client)
        body = client.get(f"/agents/{reused}/questions").json()

    assert reused == closed
    assert body["open_questions"] == 0
    assert body["elements"] == {}


def test_an_unknown_agent_is_a_404_on_read_and_every_write(bridge):
    with TestClient(bridge.app) as client:
        statuses = [
            client.get("/agents/nope/questions").status_code,
            client.post("/agents/nope/questions/q1/answer", json={"answer": "x"}).status_code,
            client.post("/agents/nope/questions/q1/skip").status_code,
            client.post("/agents/nope/questions/q1/revise").status_code,
            client.post("/agents/nope/questions/q1/request-diagram").status_code,
        ]

    assert statuses == [404] * 5


def test_writes_by_agent_id_settle_its_question_and_never_a_neighbours(bridge):
    with TestClient(bridge.app) as client:
        _, agent = _agent_on_tab(client)
        mine = _ask(bridge, agent, session_id="s1")
        theirs = _ask(bridge, "someone-else", into=agent)

        answered = client.post(f"/agents/{agent}/questions/{mine}/answer", json={"option_id": "b"})
        foreign = client.post(f"/agents/{agent}/questions/{theirs}/skip")
        revised = client.post(f"/agents/{agent}/questions/{mine}/revise")
        requested = client.post(f"/agents/{agent}/questions/{mine}/request-diagram")
        skipped = client.post(f"/agents/{agent}/questions/{mine}/skip")

    assert (answered.json()["state"], answered.json()["answer"]) == ("answered", "Microservices")
    assert foreign.status_code == 404
    assert revised.json()["state"] == "open"
    assert requested.status_code == 200
    assert skipped.json()["state"] == "skipped"
    assert store.find_element(bridge.registry.get(agent), theirs).meta["state"] == "open"


def test_get_agents_carries_each_agents_open_question_count(bridge):
    with TestClient(bridge.app) as client:
        _, agent = _agent_on_tab(client)
        _ask(bridge, agent)
        _ask(bridge, agent, question="Second?")

        listed = client.get("/agents").json()

    row = next(a for a in listed["agents"] if a["id"] == agent)
    assert row["open_questions"] == 2


def test_answering_and_asking_push_agent_questions_with_the_open_count(bridge):
    mcp = QuestionMcp(
        bridge.registry.get, attached_windows=lambda _agent_id: 1,
        questions_changed=lambda agent_id: announce(bridge.services, agent_id),
    )
    with TestClient(bridge.app) as client:
        _, agent = _agent_on_tab(client)
        question = _ask(bridge, agent)
        with client.websocket_connect("/repos/main/events") as socket:
            client.post(f"/agents/{agent}/questions/{question}/answer", json={"option_id": "a"})
            answered = _next_question_event(socket)
            client.portal.call(mcp.ask, agent, AskRequest(question="Next?", options=OPTIONS))
            asked = _next_question_event(socket)

    assert (answered["id"], answered["open_questions"]) == (agent, 0)
    assert (asked["id"], asked["open_questions"]) == (agent, 1)


def _next_question_event(socket) -> dict:
    """The next `agent-questions` frame, skipping canvas pings and other events."""
    while True:
        frame = socket.receive_json()
        if frame.get("type") == AGENT_QUESTIONS_EVENT:
            return frame


def test_announce_never_raises_when_the_count_cannot_be_read(bridge, monkeypatch):
    from codechroma.questions import agent_view

    def unreadable(*_args):
        raise OSError("gone")

    monkeypatch.setattr(agent_view, "open_count", unreadable)

    result = asyncio.run(announce(bridge.services, "ghost"))

    assert result is None
