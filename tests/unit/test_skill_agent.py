"""Unit tests pinning SkillAgent's per-job artifact path and per-run prompt override."""

import asyncio
import json
from collections import deque

import pytest

from codechroma.bridge.skill_agent import SkillAgent
from tests.unit.fake_claude import fake_claude_exec, reader, stream_json

_SETTLE_SECONDS = 0.05


def _make_agent(tmp_path, name="test_agent"):
    def artifact(repo_root, repo_id):
        return repo_root / f"{repo_id}.json"

    return SkillAgent(
        name=name,
        prompt="default prompt",
        model="haiku",
        artifact=artifact,
        validate=lambda data: isinstance(data, dict),
        timeout_env_var="TEST_AGENT_TIMEOUT_SECONDS",
        default_timeout_seconds=5,
        invalid_error="no valid artifact",
    )


async def _noop_on_change(_repo_id, _state):
    return None


def test_artifact_path_is_computed_per_repo_id(tmp_path):
    agent = _make_agent(tmp_path)

    assert agent.artifact(tmp_path, "job-a") != agent.artifact(tmp_path, "job-b")


def test_start_while_a_run_is_in_flight_does_not_spawn_a_second_process(monkeypatch, tmp_path):
    """Two start() calls on one repo while the first is still generating must not create two
    processes — the second call re-attaches to the in-flight run instead (the canvas switching
    back to a view whose diagram is mid-generation must never start a fresh `claude` run)."""
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    spawns: list[str] = []
    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        fake_claude_exec(hang=True, on_spawn=lambda: spawns.append("spawned")),
    )

    async def _drive():
        first = await agent.start("job-a", tmp_path, _noop_on_change)
        assert first["state"] == "generating"
        # Let the background task reach its subprocess-spawn so we prove a real second start()
        # can't trigger another one while the claude process itself is alive.
        await asyncio.sleep(_SETTLE_SECONDS)
        # With the first run still in flight, a second start() must return the same run, not
        # spawn another process.
        second = await agent.start("job-a", tmp_path, _noop_on_change)
        assert second["state"] == "generating"
        await agent.forget("job-a")

    asyncio.run(_drive())

    assert spawns == ["spawned"]


def test_stop_restores_the_pre_run_artifact_on_cancel(monkeypatch, tmp_path):
    """A cancelled run must not leave its half-written artifact behind: stop() rolls the target
    file back to the snapshot taken before the run started (previously the CancelledError escaped
    `_run_claude` before `_restore`, so a partial file survived and was read as a real brief)."""
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    # ⚠ Before start(): `_snapshot` runs before the spawn, so a later write is not in the snapshot.
    good = agent.artifact(tmp_path, "job-a")
    good.parent.mkdir(parents=True, exist_ok=True)
    good.write_text('{"scope": []}')

    class HalfWritingProc:
        def __init__(self):
            self.returncode = None
            self.stdout = reader(stream_json([]))
            self.stderr = reader(b"")
            self.killed = False

        async def wait(self):
            await asyncio.sleep(10)

        def kill(self):
            self.killed = True
            self.returncode = 0

    async def _exec(*_args, **_kwargs):
        # The claude process immediately overwrites the artifact with a half-written fragment, then
        # hangs -- the exact "cancelled mid-write" shape the restore must undo.
        agent.artifact(tmp_path, "job-a").write_text('{"scope": ["half-written')
        return HalfWritingProc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec)

    async def _drive():
        await agent.start("job-a", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)
        await agent.stop("job-a")

    asyncio.run(_drive())

    # The pre-run snapshot won: cancel rolled the fragment back, leaving the valid brief intact.
    assert json.loads(agent.artifact(tmp_path, "job-a").read_text()) == {"scope": []}


def test_stop_kills_an_in_flight_run_and_resets_to_idle(monkeypatch, tmp_path):
    """The canvas's Stop button kills the process and leaves the job idle — the same end state the
    user would get from waiting, minus the run completing — so a follow-up generate() can start
    fresh instead of re-attaching to a run the user just cancelled."""
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    killed = []
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", fake_claude_exec(hang=True, killed=killed)
    )

    async def _drive():
        await agent.start("job-a", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)
        state = await agent.stop("job-a")
        assert state == {"state": "idle", "error": None}
        assert agent.get_state("job-a") == {"state": "idle", "error": None}

    asyncio.run(_drive())

    assert killed == [True]
    assert agent.tasks == {}


def test_forget_drops_composite_item_keys_alongside_the_bare_repo_id(tmp_path):
    """Composite `{repo_id}:{item}` job keys must be reaped by forget, or they leak forever."""
    agent = _make_agent(tmp_path)
    agent.jobs = {
        "main": {"state": "idle", "error": None},
        "main:item-1": {"state": "error", "error": "boom"},
        "maintenance": {"state": "idle", "error": None},
        "other:item-2": {"state": "idle", "error": None},
    }
    agent.output = {key: deque(["line"]) for key in agent.jobs}

    asyncio.run(agent.forget("main"))

    # `maintenance` survives: the match is `main` or `main:*`, never a bare startswith.
    assert set(agent.jobs) == {"maintenance", "other:item-2"}
    assert set(agent.output) == {"maintenance", "other:item-2"}


def test_stop_with_nothing_running_reports_idle(monkeypatch, tmp_path):
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )

    async def _drive():
        state = await agent.stop("never-started")
        assert state == {"state": "idle", "error": None}

    asyncio.run(_drive())


def test_two_jobs_snapshot_and_restore_independent_files(monkeypatch, tmp_path):
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    (tmp_path / "job-a.json").write_text(json.dumps({"kept": "a"}))
    (tmp_path / "job-b.json").write_text(json.dumps({"kept": "b"}))
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(returncode=1))

    async def _drive():
        await agent.start("job-a", tmp_path, _noop_on_change)
        await agent.start("job-b", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())

    assert json.loads((tmp_path / "job-a.json").read_text()) == {"kept": "a"}
    assert json.loads((tmp_path / "job-b.json").read_text()) == {"kept": "b"}


def test_start_without_a_prompt_override_uses_the_default_prompt(monkeypatch, tmp_path):
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    captured = []

    def _capturing_factory(*args, **_kwargs):
        captured.extend(args)
        return fake_claude_exec(returncode=0)(*args, **_kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _capturing_factory)
    (tmp_path / "job-a.json").write_text(json.dumps({}))

    async def _drive():
        await agent.start("job-a", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())

    assert "default prompt" in captured


def test_start_with_a_prompt_override_uses_it_instead(monkeypatch, tmp_path):
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    captured = []

    def _capturing_factory(*args, **_kwargs):
        captured.extend(args)
        return fake_claude_exec(returncode=0)(*args, **_kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _capturing_factory)
    (tmp_path / "job-a.json").write_text(json.dumps({}))

    async def _drive():
        await agent.start("job-a", tmp_path, _noop_on_change, prompt="per-run prompt")
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())

    assert "per-run prompt" in captured
    assert "default prompt" not in captured


def test_run_passes_the_workspace_id_to_the_claude_env(monkeypatch, tmp_path):
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    seen_env = {}

    def _capturing_factory(*_args, **_kwargs):
        seen_env.update(_kwargs.get("env") or {})
        return fake_claude_exec(returncode=0)(*_args, **_kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _capturing_factory)
    (tmp_path / "pr-7.json").write_text(json.dumps({}))

    async def _drive():
        await agent.start("pr-7", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())

    assert seen_env.get("codechroma_WORKSPACE_ID") == "pr-7"


def test_mark_generating_flips_idle_to_generating_with_no_subprocess(tmp_path):
    agent = _make_agent(tmp_path)
    changes = []

    async def _on_change(repo_id, state):
        changes.append((repo_id, state))

    async def _drive():
        return await agent.mark_generating("job-a", _on_change)

    state = asyncio.run(_drive())

    assert state == {"state": "generating", "error": None}
    assert agent.get_state("job-a") == {"state": "generating", "error": None}
    assert changes == [("job-a", {"state": "generating", "error": None})]


def test_mark_generating_while_already_generating_is_a_no_op(tmp_path):
    """A second interactive call mid-run must not reset the output buffer or re-fire on_change."""
    agent = _make_agent(tmp_path)
    changes = []

    async def _on_change(repo_id, state):
        changes.append((repo_id, state))

    async def _drive():
        await agent.mark_generating("job-a", _on_change)
        agent.output["job-a"].append("progress line")
        return await agent.mark_generating("job-a", _on_change)

    second = asyncio.run(_drive())

    assert second == {"state": "generating", "error": None}
    assert list(agent.output["job-a"]) == ["progress line"]
    assert len(changes) == 1


def test_mark_done_with_no_error_resets_to_idle(tmp_path):
    agent = _make_agent(tmp_path)
    changes = []

    async def _on_change(repo_id, state):
        changes.append((repo_id, state))

    async def _drive():
        await agent.mark_generating("job-a", _on_change)
        return await agent.mark_done("job-a", _on_change)

    state = asyncio.run(_drive())

    assert state == {"state": "idle", "error": None}
    assert agent.get_state("job-a") == {"state": "idle", "error": None}


def test_mark_done_with_an_error_sets_the_error_state(tmp_path):
    agent = _make_agent(tmp_path)

    async def _drive():
        return await agent.mark_done("job-a", _noop_on_change, error="self-check never converged")

    state = asyncio.run(_drive())

    assert state == {"state": "error", "error": "self-check never converged"}
    assert agent.get_state("job-a") == {"state": "error", "error": "self-check never converged"}


def test_mark_done_with_an_empty_string_error_still_reports_error_not_idle(tmp_path):
    """error="" must not collapse to idle -- only error=None (no error requested) may."""
    agent = _make_agent(tmp_path)

    async def _drive():
        return await agent.mark_done("job-a", _noop_on_change, error="")

    state = asyncio.run(_drive())

    assert state == {"state": "error", "error": ""}


def test_a_failed_first_ever_run_leaves_no_half_written_artifact_behind(monkeypatch, tmp_path):
    """With no pre-run snapshot, restore deletes: a broken first file must not get rendered."""
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )

    failing = fake_claude_exec(returncode=1)

    async def _exec(*args, **kwargs):
        agent.artifact(tmp_path, "job-a").write_text('{"scope": ["half-written')
        return await failing(*args, **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec)

    asyncio.run(agent.start("job-a", tmp_path, _noop_on_change))

    assert not agent.artifact(tmp_path, "job-a").exists()


def test_a_failed_run_reports_the_readable_api_error_over_cosmetic_stderr_noise(
    monkeypatch, tmp_path
):
    """A `result` event's own message beats an unrelated stderr banner (e.g. unrecognized_model)."""
    agent = _make_agent(tmp_path)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    failing = fake_claude_exec(
        returncode=1,
        events=[{
            "type": "result", "is_error": True, "subtype": "success",
            "result": "API Error: SSL certificate verification failed",
        }],
        stderr=b'[claude-code:unrecognized_model] {"model":"deepseek-v4-flash"}\n',
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", failing)

    async def _drive():
        await agent.start("job-a", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())

    assert agent.get_state("job-a")["error"] == "✗ API Error: SSL certificate verification failed"


@pytest.fixture
def _isolated_llm_stores(tmp_path, monkeypatch):
    """Points the provider/call-site stores at a scratch dir so this test can't touch real state."""
    monkeypatch.setenv("codechroma_LLM_PROVIDERS_FILE", str(tmp_path / "providers.json"))
    monkeypatch.setenv("codechroma_LLM_CALL_SITE_SETTINGS_FILE", str(tmp_path / "call-sites.json"))


def test_resolve_cli_uses_the_agentic_call_sites_group_assignment(tmp_path, _isolated_llm_stores):
    """An agentic call site (e.g. c1_agent) resolves via its group's assignment, not its own id."""
    from codechroma.llm.call_site_settings import save_group_assignment
    from codechroma.llm.providers_store import create_provider

    provider = create_provider({"label": "Claude CLI", "kind": "cli", "adapter": "claude"})
    save_group_assignment("diagrams", {"provider_id": provider.id, "model": "claude-opus"})
    agent = _make_agent(tmp_path, name="c1_agent")

    _adapter, cli, model, env_overrides = agent.resolve_cli()

    assert cli == "claude"
    assert model == "claude-opus"
    assert env_overrides == {}


def test_resolve_cli_injects_base_url_and_key_for_a_claude_provider_with_an_endpoint(
    tmp_path, _isolated_llm_stores
):
    """A claude cli provider with its own base_url/key resolves to ANTHROPIC_* env overrides."""
    from codechroma.llm.call_site_settings import save_group_assignment
    from codechroma.llm.providers_store import create_provider

    provider = create_provider({
        "label": "Claude via proxy",
        "kind": "cli",
        "adapter": "claude",
        "base_url": "https://proxy.example.com",
        "api_key": "sk-proxy",
    })
    save_group_assignment("planning", {"provider_id": provider.id, "model": "deepseek-chat"})
    agent = _make_agent(tmp_path, name="wiki_general_agent")

    _adapter, _cli, _model, env_overrides = agent.resolve_cli()

    assert env_overrides == {
        "ANTHROPIC_BASE_URL": "https://proxy.example.com",
        "ANTHROPIC_API_KEY": "",
        "ANTHROPIC_MODEL": "deepseek-chat",
        "ANTHROPIC_AUTH_TOKEN": "sk-proxy",
    }


def test_resolve_cli_injects_tls_skip_when_provider_verify_ssl_is_off(
    tmp_path, _isolated_llm_stores
):
    from codechroma.llm.call_site_settings import save_group_assignment
    from codechroma.llm.providers_store import create_provider

    provider = create_provider({
        "label": "Claude via self-signed proxy",
        "kind": "cli",
        "adapter": "claude",
        "base_url": "https://proxy.example.com",
        "api_key": "sk-proxy",
        "verify_ssl": False,
    })
    save_group_assignment("planning", {"provider_id": provider.id, "model": "deepseek-chat"})
    agent = _make_agent(tmp_path, name="wiki_general_agent")

    *_rest, env_overrides = agent.resolve_cli()

    assert env_overrides["NODE_TLS_REJECT_UNAUTHORIZED"] == "0"


def test_resolve_cli_env_overrides_empty_without_a_base_url(tmp_path, _isolated_llm_stores):
    from codechroma.llm.call_site_settings import save_group_assignment
    from codechroma.llm.providers_store import create_provider

    provider = create_provider({"label": "Claude CLI", "kind": "cli", "adapter": "claude"})
    save_group_assignment("planning", {"provider_id": provider.id, "model": "haiku"})
    agent = _make_agent(tmp_path, name="wiki_general_agent")

    *_rest, env_overrides = agent.resolve_cli()

    assert env_overrides == {}


def test_start_passes_provider_env_overrides_into_the_subprocess_env(
    monkeypatch, tmp_path, _isolated_llm_stores
):
    """The claude subprocess actually receives ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN."""
    from codechroma.llm.call_site_settings import save_group_assignment
    from codechroma.llm.providers_store import create_provider

    provider = create_provider({
        "label": "Claude via proxy",
        "kind": "cli",
        "adapter": "claude",
        "base_url": "https://proxy.example.com",
        "api_key": "sk-proxy",
    })
    save_group_assignment("planning", {"provider_id": provider.id, "model": "deepseek-chat"})
    agent = _make_agent(tmp_path, name="wiki_general_agent")
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    seen_envs = []
    seen_argvs = []

    async def _exec(*args, **kwargs):
        seen_argvs.append(args)
        seen_envs.append(kwargs.get("env"))
        return await fake_claude_exec()(*args, **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec)

    asyncio.run(agent.start("job-a", tmp_path, _noop_on_change))

    assert seen_envs[0]["ANTHROPIC_BASE_URL"] == "https://proxy.example.com"
    assert seen_envs[0]["ANTHROPIC_API_KEY"] == ""
    assert seen_envs[0]["ANTHROPIC_AUTH_TOKEN"] == "sk-proxy"
    assert seen_envs[0]["ANTHROPIC_MODEL"] == "deepseek-chat"
    assert "--model" not in seen_argvs[0]


def test_start_omits_bare_for_a_keyless_proxy_even_with_a_real_key_on_the_bridge_process(
    monkeypatch, tmp_path, _isolated_llm_stores
):
    """A no-auth proxy provider must not inherit --bare from the bridge's own ANTHROPIC_API_KEY."""
    from codechroma.llm.call_site_settings import save_group_assignment
    from codechroma.llm.providers_store import create_provider

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-bridge-process-key")
    provider = create_provider({
        "label": "Claude via keyless proxy",
        "kind": "cli",
        "adapter": "claude",
        "base_url": "https://proxy.example.com",
    })
    save_group_assignment("planning", {"provider_id": provider.id, "model": "deepseek-chat"})
    agent = _make_agent(tmp_path, name="wiki_general_agent")
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    seen_argvs = []

    async def _exec(*args, **kwargs):
        seen_argvs.append(args)
        return await fake_claude_exec()(*args, **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec)

    asyncio.run(agent.start("job-a", tmp_path, _noop_on_change))

    assert "--bare" not in seen_argvs[0]
