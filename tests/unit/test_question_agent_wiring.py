"""Phase 3 wiring: MCP argv registration, endpoint discovery, the ask route and the hook."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.resources import resource_path
from codechroma.questions.launch import McpEndpoint, discover_base_url, loopback_url
from codechroma.questions.mcp_server import QuestionMcp
from codechroma.terminal.agents import agent_cli

ENDPOINT = McpEndpoint("agent-1", "http://127.0.0.1:8123", "agent-1.sig")


def _load_hook():
    path = resource_path("skills").parent / "hooks" / "ask_user_question_hook.py"
    spec = importlib.util.spec_from_file_location("ask_user_question_hook", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_claude_argv_registers_the_mcp_config_before_the_plugin_dir():
    argv, env = agent_cli("claude", mcp=ENDPOINT)

    assert argv[1] == "--mcp-config"
    assert argv[3] == "--plugin-dir"
    assert env == {
        "CODECHROMA_BRIDGE_URL": "http://127.0.0.1:8123",
        "CODECHROMA_QUESTION_TOKEN": "agent-1.sig",
    }


def test_mcp_config_file_holds_an_http_server_with_bearer_header_and_timeout():
    argv, _ = agent_cli("claude", mcp=ENDPOINT)

    server = json.loads(Path(argv[2]).read_text(encoding="utf-8"))["mcpServers"]["codechroma"]

    assert server["type"] == "http"
    assert server["url"] == "http://127.0.0.1:8123/mcp/"
    assert server["headers"] == {"Authorization": "Bearer agent-1.sig"}
    assert server["timeout"] > 300_000


def test_claude_argv_is_unchanged_without_an_endpoint():
    argv, env = agent_cli("claude")

    assert "--mcp-config" not in argv
    assert env == {}


def test_discover_base_url_reads_the_uvicorn_port_from_argv(monkeypatch):
    monkeypatch.delenv("CODECHROMA_BRIDGE_URL", raising=False)

    url = discover_base_url(["uvicorn", "app:app", "--port", "9100"])

    assert url == "http://127.0.0.1:9100"


def test_discover_base_url_is_none_without_a_port(monkeypatch):
    monkeypatch.delenv("CODECHROMA_BRIDGE_URL", raising=False)

    assert discover_base_url(["pytest", "-n", "2"]) is None


@pytest.mark.parametrize(
    ("given", "expected"),
    [("http://localhost:8000/", "http://127.0.0.1:8000"), ("http://testserver/", None)],
)
def test_loopback_url_needs_an_explicit_port(given, expected):
    assert loopback_url(given) == expected


def test_endpoint_for_signs_a_token_that_names_the_workspace(monkeypatch):
    monkeypatch.delenv("CODECHROMA_BRIDGE_URL", raising=False)
    mcp = QuestionMcp(broker=None, workspace_for=lambda _id: None)
    mcp.remember_base_url("http://localhost:8765/")

    endpoint = mcp.endpoint_for("agent-7")

    assert endpoint.base_url == "http://127.0.0.1:8765"
    assert mcp.workspace_id_for(endpoint.token) == "agent-7"


def test_ask_route_rejects_a_missing_token(bridge):
    with TestClient(bridge.app) as client:
        response = client.post("/repos/main/questions/ask", json={"question": "Q?"})

    assert response.status_code == 401


def test_ask_route_rejects_a_token_for_another_workspace(bridge):
    token = bridge.app.state.question_mcp.token_for("other")

    with TestClient(bridge.app) as client:
        response = client.post(
            "/repos/main/questions/ask", json={"question": "Q?"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 401


def test_hook_payload_invents_no_rank_and_is_flagged_degraded():
    hook = _load_hook()
    question = {"question": "DB?", "options": [{"label": "PG"}, {"label": "SQLite"}]}

    payload = hook.build_payload(question, 0, 1, "s")

    assert all("rank" not in option for option in payload["options"])
    assert payload["options"][1]["title"] == "SQLite"
    assert payload["degraded"] is True


def test_hook_denies_the_native_tool_and_names_ask_user_when_the_bridge_answers(
    monkeypatch, capsys
):
    import io

    hook = _load_hook()
    monkeypatch.setenv("CODECHROMA_BRIDGE_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("CODECHROMA_QUESTION_TOKEN", "t")
    monkeypatch.setenv("CODECHROMA_WORKSPACE_ID", "w")
    monkeypatch.setattr(hook, "bridge_answers", lambda _url: True)
    event = {"tool_input": {"questions": [{"question": "A?", "options": []}]}}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(event)))

    code = hook.main()

    out = json.loads(capsys.readouterr().out)["hookSpecificOutput"]
    assert code == 0
    assert out["permissionDecision"] == "deny"
    assert "mcp__codechroma__ask_user" in out["permissionDecisionReason"]


def test_hook_collects_answers_keyed_by_question_text():
    hook = _load_hook()
    questions = [{"question": "A?", "options": []}, {"question": "B?", "options": []}]

    answers = hook.collect_answers(questions, lambda p: {"answer": p["question"] + "!"})

    assert answers == {"A?": "A?!", "B?": "B?!"}


@pytest.mark.parametrize("result", [{"pending": True, "question_id": "q"}, {"skipped": True}])
def test_hook_collects_nothing_when_a_question_is_pending_or_skipped(result):
    hook = _load_hook()

    assert hook.collect_answers([{"question": "A?"}], lambda _p: result) is None


def test_hook_decision_echoes_the_input_and_adds_answers():
    hook = _load_hook()

    out = hook.decision({"questions": [{"question": "A?"}]}, {"A?": "yes"})["hookSpecificOutput"]

    assert out["permissionDecision"] == "allow"
    assert out["updatedInput"] == {"questions": [{"question": "A?"}], "answers": {"A?": "yes"}}


def test_hook_prints_nothing_when_the_bridge_env_is_absent(monkeypatch, capsys):
    hook = _load_hook()
    for name in ("CODECHROMA_BRIDGE_URL", "CODECHROMA_QUESTION_TOKEN", "CODECHROMA_WORKSPACE_ID"):
        monkeypatch.delenv(name, raising=False)

    code = hook.main()

    assert code == 0
    assert capsys.readouterr().out == ""


def test_hook_fails_open_when_the_bridge_is_unreachable(monkeypatch, capsys):
    import io

    hook = _load_hook()
    monkeypatch.setenv("CODECHROMA_BRIDGE_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("CODECHROMA_QUESTION_TOKEN", "t")
    monkeypatch.setenv("CODECHROMA_WORKSPACE_ID", "w")
    event = {"tool_input": {"questions": [{"question": "A?", "options": []}]}}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(event)))

    code = hook.main()

    assert code == 0
    assert capsys.readouterr().out == ""


def test_hooks_json_wires_ask_user_question_with_block_on_failure():
    path = resource_path("skills").parent / "hooks" / "hooks.json"

    entry = json.loads(path.read_text(encoding="utf-8"))["hooks"]["PreToolUse"][0]

    assert entry["matcher"] == "AskUserQuestion"
    assert entry["hooks"][0]["onFailure"] == "block"
    assert entry["hooks"][0]["timeout"] >= 600


def test_grill_skill_has_name_and_description_frontmatter():
    text = (resource_path("skills") / "codechroma-grill" / "SKILL.md").read_text(encoding="utf-8")

    assert text.startswith("---\nname: codechroma-grill\ndescription: ")
    assert "ask_user_result" in text
