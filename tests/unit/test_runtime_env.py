from __future__ import annotations

import errno
import json
import os
import re
import subprocess
import threading
from pathlib import Path

import pytest

from codechroma.llm import runtime_env as runtime
from codechroma.llm.runtime_settings import RuntimeSettings, validate_settings


def executable(directory: Path, name: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (name + ".EXE" if os.name == "nt" else name)
    path.write_text("executable")
    path.chmod(0o755)
    return path


@pytest.fixture
def service(tmp_path, monkeypatch):
    inherited = {
        "HOME": str(tmp_path),
        "PATH": str(tmp_path / "inherited"),
        "TOKEN": "inherited-secret",
        "codechroma_RUNTIME_SETTINGS_FILE": "internal",
    }
    monkeypatch.setattr(runtime, "_select_shell", lambda *_: ("/bin/fish", ()))
    monkeypatch.setattr(runtime, "_probe", lambda *_: ({}, "unavailable", (), "fish"))
    return runtime.RuntimeEnvironment(RuntimeSettings(), inherited, platform="linux")


def test_inherited_claude(service):
    path = executable(Path(service.home) / "inherited", "claude")
    found = service.resolve("claude")
    assert found.executable == str(path)
    assert found.env["PATH"].split(os.pathsep)[0] == str(path.parent)


@pytest.mark.parametrize("shell", ["bash", "zsh", "fish", "nu", "csh", "tcsh", "xonsh", "pwsh"])
def test_shell_arguments(shell):
    argv, alternate, kind = runtime._shell_command(
        f"/usr/bin/{shell}", ["/my tools/helper", "marker"]
    )
    assert kind == shell
    if shell in {"csh", "tcsh"}:
        assert argv[0] == "-" + shell and alternate == f"/usr/bin/{shell}"
    elif shell == "nu":
        assert "--login" in argv and "--interactive" in argv and argv[-1].startswith("^")
    elif shell == "pwsh":
        assert "-Command" in argv and argv[-1].startswith("& ")
    else:
        assert argv[1:4] == ["-l", "-i", "-c"]


@pytest.mark.parametrize("name", ["claude", "gh", "codex", "gemini"])
def test_login_shell_tools_and_capture_override_merge(service, monkeypatch, name):
    directory = Path(service.home) / "managed tools"
    path = executable(directory, name)
    calls = []

    def probe(*args):
        calls.append(threading.current_thread().name)
        return (
            {"PATH": str(directory), "TOKEN": "shell-secret", "MISE_DATA_DIR": "manager"},
            None,
            (),
            "fish",
        )

    monkeypatch.setattr(runtime, "_probe", probe)
    found = service.resolve(name, {"TOKEN": "provider-secret"})
    assert found.executable == str(path)
    assert found.env["TOKEN"] == "provider-secret"
    assert service.snapshot().environment["TOKEN"] == "shell-secret"
    assert found.env["MISE_DATA_DIR"] == "manager"
    assert calls == ["codechroma-environment"]
    service.resolve(name)
    assert len(calls) == 1


def test_snapshot_is_immutable_and_diagnostics_hide_secrets(service):
    snapshot = service.snapshot()
    with pytest.raises(TypeError):
        snapshot.environment["TOKEN"] = "changed"
    assert "inherited-secret" not in repr(snapshot)
    assert "inherited-secret" not in json.dumps(snapshot.diagnostics())
    assert "codechroma_RUNTIME_SETTINGS_FILE" not in snapshot.environment
    assert "CODECHROMA_RESOLVING_ENVIRONMENT" not in service.spawn_env(
        {
            "CODECHROMA_RESOLVING_ENVIRONMENT": "1",
        }
    )
    assert (
        service.spawn_env({"codechroma_WORKSPACE_ID": "agent"})["codechroma_WORKSPACE_ID"]
        == "agent"
    )


def test_explicit_override_preserves_launcher_symlink_and_never_falls_back(service):
    path = executable(Path(service.home) / "custom", "claude")
    service.options = RuntimeSettings(cli_paths={"claude": str(path)})
    assert service.resolve("claude").executable == str(path)
    service.options = RuntimeSettings(cli_paths={"claude": str(path.parent / "missing")})
    with pytest.raises(runtime.CliLookupError, match="Configured CLI path .* does not exist"):
        service.resolve("claude", recheck=True)


@pytest.mark.skipif(os.name == "nt", reason="requires POSIX executable symlinks")
def test_symlink_not_canonicalized(service):
    target = executable(Path(service.home) / "versions", "claude")
    link = Path(service.home) / "inherited" / "claude"
    link.parent.mkdir()
    link.symlink_to(target)
    assert service.resolve("claude").executable == str(link)


def test_fallback_location_is_in_launch_path_even_from_cache(service, monkeypatch):
    directory = Path(service.home) / ".local/bin"
    path = executable(directory, "claude")
    monkeypatch.setattr(
        runtime,
        "_probe",
        lambda *_: (
            {"PATH": str(Path(service.home) / "managed")},
            None,
            (),
            "fish",
        ),
    )
    first = service.resolve("claude")
    second = service.resolve("claude")
    assert first.path_source == "well-known executable location"
    assert second.executable == str(path)
    assert first.env["PATH"] == second.env["PATH"]
    assert str(directory) in first.env["PATH"].split(os.pathsep)


def test_negative_cache_rescan_and_recapture_are_rate_limited(service, monkeypatch):
    calls = []
    monkeypatch.setattr(runtime, "_probe", lambda *_: (calls.append(1) or {}, "failed", (), "fish"))
    for _ in range(3):
        with pytest.raises(runtime.CliLookupError):
            service.resolve("not-installed")
    assert len(calls) == 1
    path = executable(Path(service.home) / "inherited", "not-installed")
    assert service.resolve("not-installed", recheck=True).executable == str(path)
    service.refresh("missing CLI").result()
    assert len(calls) == 1
    service.refresh("user requested", force=True).result()
    assert len(calls) == 2


def test_refresh_invalidates_positive_cache_and_generations(service, monkeypatch):
    first = executable(Path(service.home) / "inherited", "claude")
    original = service.resolve("claude")
    second = executable(Path(service.home) / "new", "claude")
    monkeypatch.setattr(
        runtime, "_probe", lambda *_: ({"PATH": str(second.parent)}, None, (), "fish")
    )
    service.refresh("Re-detect", force=True).result()
    resolved = service.resolve("claude")
    assert resolved.executable == str(second)
    assert original.executable == str(first)
    assert resolved.generation == original.generation + 1
    assert original.env["PATH"] != resolved.env["PATH"]


@pytest.mark.parametrize("failure", [errno.ENOENT, errno.EACCES])
def test_launch_failure_invalidates_resolution_cache(service, monkeypatch, failure):
    executable(Path(service.home) / "inherited", "claude")
    service.resolve("claude")
    reasons = []
    monkeypatch.setattr(service, "refresh", lambda reason: reasons.append(reason))
    service.launch_failed(OSError(failure, "failed"))
    assert not service._records
    assert reasons == ["executable launch failed"]


def test_shell_selection_priority_and_invalid_shell_fallback(monkeypatch):
    monkeypatch.setattr(
        runtime, "_executable", lambda path: path in {"/settings/fish", "/env/bash"}
    )
    selected, _ = runtime._select_shell(
        RuntimeSettings(shell="/settings/fish"), {"SHELL": "/env/bash"}, "linux"
    )
    assert selected == os.path.abspath("/settings/fish")
    selected, warnings = runtime._select_shell(
        RuntimeSettings(shell="/missing"), {"SHELL": "/env/bash"}, "linux"
    )
    assert selected == os.path.abspath("/env/bash") and warnings


def test_json_transport_ignores_noise_and_accepts_nonzero_exit(monkeypatch, tmp_path):
    seen = {}

    class Process:
        def __init__(self, argv, **kwargs):
            seen.update(kwargs)
            marker = re.search(r"CODECHROMA_ENV_[a-f0-9]+", argv[-1])[0]
            payload = json.dumps({"PATH": str(tmp_path), "VALUE": "multiline\nwith spaces"})
            kwargs["stdout"].write(("banner\n" + marker + payload + marker + "\nlogout").encode())

        def wait(self, timeout):
            return 1

    monkeypatch.setattr(runtime.subprocess, "Popen", Process)
    captured, error, warnings, kind = runtime._probe("/bin/fish", str(tmp_path), {}, 10)
    assert captured["VALUE"] == "multiline\nwith spaces"
    assert error is None and warnings == ("Shell exited with status 1",) and kind == "fish"
    assert seen["cwd"] == str(tmp_path)
    assert seen["stdin"] == subprocess.DEVNULL
    assert seen["env"]["CODECHROMA_RESOLVING_ENVIRONMENT"] == "1"
    assert seen["start_new_session"] == (os.name != "nt")


def test_malformed_capture_falls_back_without_leaking_values(monkeypatch, tmp_path):
    class Process:
        def __init__(self, argv, **kwargs):
            kwargs["stdout"].write(b"password=must-not-appear\ninvalid JSON")

        def wait(self, timeout):
            return 0

    monkeypatch.setattr(runtime.subprocess, "Popen", Process)
    captured, error, _, _ = runtime._probe("/bin/bash", str(tmp_path), {}, 10)
    assert captured == {} and error == "Shell did not return a valid JSON environment"
    assert "must-not-appear" not in error


def test_detection_and_launch_share_the_snapshot(service, monkeypatch, tmp_path):
    from codechroma.bridge.agents import sessions

    path = executable(Path(service.home) / "inherited", "claude")
    monkeypatch.setattr(runtime, "get_runtime_environment", lambda: service)
    detected = service.resolve("claude")
    seen = {}

    def launch(_id, argv, cwd, **kwargs):
        seen.update(argv=argv, env=kwargs["env"])
        return object()

    monkeypatch.setattr(sessions, "AgentSession", launch)
    sessions.AgentSessionRegistry().start("agent", ["claude"], tmp_path)
    assert seen["argv"][0] == str(path)
    assert dict(detected.env) == dict(seen["env"])


def test_settings_validation():
    assert validate_settings({"cli_paths": {"claude": "/my tools/claude"}}).timeout_seconds == 10
    with pytest.raises(ValueError):
        validate_settings({"timeout_seconds": float("nan")})
    with pytest.raises(ValueError):
        validate_settings({"cli_paths": {"claude": "alias claude"}})


def test_timeout_terminates_probe_group_and_falls_back(monkeypatch, tmp_path):
    killed = []

    class Process:
        pid = 123

        def __init__(self, argv, **kwargs):
            pass

        def wait(self, timeout=None):
            if timeout is not None:
                raise subprocess.TimeoutExpired("shell", timeout)
            return -9

    monkeypatch.setattr(runtime.subprocess, "Popen", Process)
    monkeypatch.setattr(runtime, "_terminate_probe", lambda process: killed.append(process.pid))
    captured, error, _, _ = runtime._probe("/bin/fish", str(tmp_path), {}, 0.1)
    assert killed == [123]
    assert captured == {} and error == "Shell environment capture timed out"


def test_gh_detection_and_subprocess_use_same_snapshot(service, monkeypatch, tmp_path):
    from codechroma.bridge.agents import publish
    from codechroma.bridge.prs.github import has_gh

    path = executable(Path(service.home) / "inherited", "gh")
    monkeypatch.setattr(runtime, "get_runtime_environment", lambda: service)
    seen = {}

    class Process:
        returncode = 0

        def __init__(self, argv, **kwargs):
            seen.update(argv=argv, env=kwargs["env"])

        def communicate(self, timeout):
            return "ok", ""

    assert has_gh()
    detected = service.resolve("gh")
    monkeypatch.setattr(publish.subprocess, "Popen", Process)
    assert publish.run_gh(tmp_path, "auth", "status") == "ok"
    assert seen["argv"] == [str(path), "auth", "status"]
    assert seen["env"] == dict(detected.env)


def test_path_order_dedup_and_no_repository_search(service, monkeypatch):
    managed = str(Path(service.home) / "managed")
    inherited = service.inherited["PATH"]
    monkeypatch.setattr(
        runtime,
        "_probe",
        lambda *_: (
            {"PATH": os.pathsep.join([managed, inherited, managed, ".", ""])},
            None,
            (),
            "fish",
        ),
    )
    assert service.snapshot().path == (managed, inherited)


def test_multiple_start_calls_share_one_capture(service, monkeypatch):
    calls = []
    monkeypatch.setattr(runtime, "_probe", lambda *_: (calls.append(1) or {}, None, (), "fish"))
    pending = [service.start() for _ in range(5)]
    assert all(item.result() is pending[0].result() for item in pending)
    assert calls == [1]


def test_frozen_runtime_restores_user_loader_paths(monkeypatch, tmp_path):
    bundled = str(tmp_path / "bundle")
    user_lib = str(tmp_path / "user-libraries")
    user_python = str(tmp_path / "user-python")
    monkeypatch.setattr(runtime.sys, "frozen", True, raising=False)
    monkeypatch.setattr(runtime.sys, "_MEIPASS", bundled, raising=False)
    env = runtime._clean(
        {
            "LD_LIBRARY_PATH": bundled,
            "LD_LIBRARY_PATH_ORIG": user_lib,
            "PYTHONPATH": os.pathsep.join([bundled, user_python]),
            "PYTHONHOME": bundled,
            "_PYI_APPLICATION_HOME_DIR": bundled,
        }
    )
    assert env["LD_LIBRARY_PATH"] == user_lib
    assert env["PYTHONPATH"] == user_python
    assert "PYTHONHOME" not in env and "LD_LIBRARY_PATH_ORIG" not in env
    assert "_PYI_APPLICATION_HOME_DIR" not in env
