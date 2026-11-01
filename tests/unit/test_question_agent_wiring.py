"""Phase 3 wiring: MCP argv registration, endpoint discovery, the ask route and the hook."""

from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.git_cmd import run_git
from codechroma.bridge.resources import resource_path
from codechroma.questions.launch import (
    McpEndpoint,
    discover_base_url,
    loopback_url,
    write_claude_config,
)
from codechroma.questions.mcp_server import QuestionMcp
from codechroma.terminal.agents import agent_cli

ENDPOINT = McpEndpoint("agent-1", "http://127.0.0.1:8123", "agent-1.sig")


def _load_hook():
    path = resource_path("skills").parent / "hooks" / "ask_user_question_hook.py"
    spec = importlib.util.spec_from_file_location("ask_user_question_hook", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_mcp_config_is_written_to_a_private_per_process_dir():
    path = write_claude_config(ENDPOINT)

    assert path.parent.name.startswith("codechroma-mcp-")
    assert path.parent != Path(tempfile.gettempdir()) / "codechroma-mcp"
    assert json.loads(path.read_text(encoding="utf-8"))["mcpServers"]["codechroma"]["url"] == (
        "http://127.0.0.1:8123/mcp/"
    )


def test_claude_argv_registers_an_http_mcp_config_with_bearer_header_before_the_plugin_dir():
    argv, env = agent_cli("claude", mcp=ENDPOINT)

    server = json.loads(Path(argv[2]).read_text(encoding="utf-8"))["mcpServers"]["codechroma"]
    assert argv[1] == "--mcp-config"
    assert argv[3] == "--plugin-dir"
    assert env == {
        "CODECHROMA_BRIDGE_URL": "http://127.0.0.1:8123",
        "CODECHROMA_QUESTION_TOKEN": "agent-1.sig",
    }
    assert server["type"] == "http"
    assert server["url"] == "http://127.0.0.1:8123/mcp/"
    assert server["headers"] == {"Authorization": "Bearer agent-1.sig"}
    assert server["timeout"] == 60_000


def test_claude_argv_is_unchanged_without_an_endpoint():
    argv, env = agent_cli("claude")

    assert "--mcp-config" not in argv
    assert env == {}


def _route_agents_to(monkeypatch, adapter_key: str, binary: str) -> None:
    from codechroma.llm import resolve_cli
    from codechroma.llm.resolve_cli import CliResolution

    monkeypatch.setattr(
        resolve_cli,
        "resolve_cli",
        lambda _call_site, _model: CliResolution(
            adapter_key=adapter_key, binary=binary, model="m", env_overrides={},
            provider_assigned=True,
        ),
    )


def test_codex_window_registers_the_server_with_overrides_and_keeps_the_token_out_of_argv(
    monkeypatch,
):
    _route_agents_to(monkeypatch, "codex", "codex")

    argv, env = agent_cli("agent", initial_prompt="do it", mcp=ENDPOINT)

    assert "mcp_servers.codechroma.url=http://127.0.0.1:8123/mcp/" in argv
    assert "mcp_servers.codechroma.bearer_token_env_var=CODECHROMA_QUESTION_TOKEN" in argv
    assert argv[-1] == "do it"
    assert not any("agent-1.sig" in arg for arg in argv)
    assert env["CODECHROMA_QUESTION_TOKEN"] == "agent-1.sig"


def test_gemini_window_gets_a_system_settings_file_with_the_http_server(monkeypatch):
    _route_agents_to(monkeypatch, "gemini", "gemini")

    _argv, env = agent_cli("agent", mcp=ENDPOINT)

    settings_file = Path(env["GEMINI_CLI_SYSTEM_SETTINGS_PATH"])
    server = json.loads(settings_file.read_text(encoding="utf-8"))["mcpServers"]["codechroma"]
    assert server["httpUrl"] == "http://127.0.0.1:8123/mcp/"
    assert server["headers"] == {"Authorization": "Bearer agent-1.sig"}


def _kimi_mcp_file(workdir: Path, text: str) -> Path:
    config = workdir / ".kimi-code" / "mcp.json"
    config.parent.mkdir()
    config.write_text(text, encoding="utf-8")
    return config


def test_kimi_window_merges_the_server_into_its_project_mcp_file(monkeypatch, tmp_path):
    _route_agents_to(monkeypatch, "kimi-cli", "kimi")
    config = _kimi_mcp_file(tmp_path, '{"mcpServers": {"mine": {"command": "tool"}}}')

    _argv, env = agent_cli("agent", mcp=ENDPOINT, workdir=tmp_path)

    servers = json.loads(config.read_text(encoding="utf-8"))["mcpServers"]
    assert servers["mine"] == {"command": "tool"}
    assert servers["codechroma"] == {
        "transport": "http", "url": "http://127.0.0.1:8123/mcp/",
        "bearerTokenEnvVar": "CODECHROMA_QUESTION_TOKEN",
    }
    assert env["CODECHROMA_QUESTION_TOKEN"] == "agent-1.sig"


def test_kimi_window_leaves_an_unreadable_mcp_file_alone(monkeypatch, tmp_path):
    _route_agents_to(monkeypatch, "kimi-cli", "kimi")
    config = _kimi_mcp_file(tmp_path, "{ broken")

    _argv, env = agent_cli("agent", mcp=ENDPOINT, workdir=tmp_path)

    assert config.read_text(encoding="utf-8") == "{ broken"
    assert "CODECHROMA_QUESTION_TOKEN" not in env


def test_kimi_window_leaves_a_git_tracked_mcp_file_alone(monkeypatch, tmp_path):
    _route_agents_to(monkeypatch, "kimi-cli", "kimi")
    config = _kimi_mcp_file(tmp_path, '{"mcpServers": {}}')
    run_git(tmp_path, "init", "-q")
    run_git(tmp_path, "add", ".kimi-code/mcp.json")

    _argv, env = agent_cli("agent", mcp=ENDPOINT, workdir=tmp_path)

    assert config.read_text(encoding="utf-8") == '{"mcpServers": {}}'
    assert "CODECHROMA_QUESTION_TOKEN" not in env


def test_kimi_window_gets_no_server_when_the_mcp_file_cannot_be_written(monkeypatch, tmp_path):
    _route_agents_to(monkeypatch, "kimi-cli", "kimi")
    (tmp_path / ".kimi-code").write_text("not a folder", encoding="utf-8")

    _argv, env = agent_cli("agent", mcp=ENDPOINT, workdir=tmp_path)

    assert "CODECHROMA_QUESTION_TOKEN" not in env


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
    mcp = QuestionMcp(workspace_for=lambda _id: None)
    mcp.remember_base_url("http://localhost:8765/")

    endpoint = mcp.endpoint_for("agent-7")

    assert endpoint.base_url == "http://127.0.0.1:8765"
    assert mcp.workspace_id_for(endpoint.token) == "agent-7"


def test_ask_route_rejects_a_missing_token_and_a_token_for_another_workspace(bridge):
    token = bridge.app.state.question_mcp.token_for("other")

    with TestClient(bridge.app) as client:
        missing = client.post("/repos/main/questions/ask", json={"question": "Q?"})
        foreign = client.post(
            "/repos/main/questions/ask", json={"question": "Q?"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert (missing.status_code, foreign.status_code) == (401, 401)


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
    assert entry["hooks"][0]["timeout"] <= 30


def test_grill_skill_has_name_and_description_frontmatter():
    text = (resource_path("skills") / "codechroma-grill" / "SKILL.md").read_text(encoding="utf-8")

    assert text.startswith("---\nname: codechroma-grill\ndescription: ")
    assert "ask_user_result" in text


def test_hook_fails_open_without_the_token_that_marks_a_wired_mcp_server(monkeypatch, capsys):
    import io

    hook = _load_hook()
    monkeypatch.setenv("CODECHROMA_BRIDGE_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("CODECHROMA_WORKSPACE_ID", "w")
    monkeypatch.delenv("CODECHROMA_QUESTION_TOKEN", raising=False)
    monkeypatch.delenv("codechroma_QUESTION_TOKEN", raising=False)
    monkeypatch.setattr(hook, "bridge_answers", lambda _url: True)
    event = {"tool_input": {"questions": [{"question": "A?", "options": []}]}}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(event)))

    code = hook.main()

    assert code == 0
    assert capsys.readouterr().out == ""


def test_mcp_instructions_match_the_shared_contract_text():
    from codechroma.questions.mcp_server import _INSTRUCTIONS

    fixture = Path(__file__).parents[1] / "fixtures" / "bridge_contract" / "mcp_instructions.txt"
    shared = fixture.read_text(encoding="utf-8")

    assert _INSTRUCTIONS == shared
