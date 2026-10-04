"""One immutable runtime snapshot for executable detection and every launch.

Shell capture runs once on a background thread, from HOME, using a JSON helper.
Diagnostics never expose captured variable values. Executable paths keep symlinks.
"""

from __future__ import annotations

import contextlib
import errno
import json
import os
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Mapping
from concurrent.futures import Future
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType

from codechroma.llm.runtime_settings import RuntimeSettings, load_runtime_settings, settings_path


def _executable(path: str) -> bool:
    return bool(path and os.path.isfile(path) and os.access(path, os.X_OK))


def _clean(env: Mapping[str, str]) -> dict[str, str]:
    # Retain skill bridge/workspace identity, never probe/settings/bundler internals.
    result = {
        k: v
        for k, v in env.items()
        if not (
            k.upper().startswith(("_PYI_", "_MEIPASS", "PYINSTALLER_"))
            or k == "CODECHROMA_RESOLVING_ENVIRONMENT"
            or (
                k.lower().startswith("codechroma_")
                and k not in {"codechroma_BRIDGE_URL", "codechroma_WORKSPACE_ID"}
            )
            or k.startswith("BASH_FUNC_")
        )
    }
    if getattr(sys, "frozen", False):
        # Restore native loader variables modified by PyInstaller before launching system tools.
        for key in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
            original = env.get(key + "_ORIG")
            if original is not None:
                if original:
                    result[key] = original
                else:
                    result.pop(key, None)
            result.pop(key + "_ORIG", None)
        bundled = getattr(sys, "_MEIPASS", None)
        if bundled:
            prefix = os.path.normcase(os.path.abspath(bundled))

            def inside_bundle(value: str) -> bool:
                normalized = os.path.normcase(os.path.abspath(value))
                return normalized == prefix or normalized.startswith(prefix + os.sep)

            for key in ("PATH", "PYTHONPATH", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
                if key in result:
                    cleaned = os.pathsep.join(
                        p for p in result[key].split(os.pathsep) if p and not inside_bundle(p)
                    )
                    if cleaned:
                        result[key] = cleaned
                    else:
                        result.pop(key, None)
            if result.get("PYTHONHOME") and inside_bundle(result["PYTHONHOME"]):
                result.pop("PYTHONHOME")
    return result


def _fallback_dirs(home: str, platform: str) -> tuple[str, ...]:
    if platform == "win32":
        return (str(Path(home) / ".local/bin"), str(Path(home) / "AppData/Roaming/npm"))
    return (
        str(Path(home) / ".local/bin"),
        str(Path(home) / "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    )


def _path_entries(*values: str) -> tuple[str, ...]:
    result: dict[str, str] = {}
    for value in values:
        for entry in value.split(os.pathsep):
            # No implicit current-repository lookup, including relative shell PATH entries.
            if not entry or not os.path.isabs(entry):
                continue
            normalized = os.path.normpath(entry)
            result.setdefault(os.path.normcase(normalized), normalized)
    return tuple(result.values())


@dataclass(frozen=True)
class EnvironmentSnapshot:
    generation: int
    environment: Mapping[str, str] = field(repr=False)
    captured_environment: Mapping[str, str] = field(repr=False)
    path: tuple[str, ...]
    source: str
    shell: str | None
    shell_type: str | None
    captured_at: float
    duration_seconds: float
    warnings: tuple[str, ...] = ()
    capture_error: str | None = None

    def diagnostics(self) -> dict:
        return {
            "generation": self.generation,
            "source": self.source,
            "shell": self.shell,
            "shell_type": self.shell_type,
            "captured_at": self.captured_at,
            "duration_seconds": self.duration_seconds,
            "path": list(self.path),
            "variable_names": sorted(self.environment),
            "warnings": list(self.warnings),
            "capture_error": self.capture_error,
        }


class CliLaunchError(RuntimeError):
    """Safe launch diagnostic suitable for display to the user."""


class CliLookupError(ValueError):
    """Lookup failed; no shell alias/function is ever accepted as a CLI."""


@dataclass(frozen=True)
class RuntimeCli:
    executable: str
    env: Mapping[str, str] = field(repr=False)
    path_source: str
    generation: int = 0
    resolved_at: float = field(default_factory=time.time)
    version: str | None = None

    def launch_error(self, exc: Exception) -> str:
        # OSError.strerror is safe; arbitrary exception strings may embed env/credentials.
        detail = exc.strerror if isinstance(exc, OSError) else type(exc).__name__
        return (
            f"Resolved CLI {self.executable!r}, but process launch failed "
            f"({self.path_source}, environment {self.generation}): {detail}"
        )


@dataclass(frozen=True)
class ResolutionRecord:
    name: str
    executable: str | None
    source: str
    generation: int
    timestamp: float
    failure_reason: str | None = None
    version: str | None = None

    def diagnostics(self) -> dict:
        return {
            "name": self.name,
            "executable": self.executable,
            "source": self.source,
            "generation": self.generation,
            "timestamp": self.timestamp,
            "failure_reason": self.failure_reason,
            "version": self.version,
        }


def _select_shell(
    options: RuntimeSettings, inherited: Mapping[str, str], platform: str
) -> tuple[str | None, tuple[str, ...]]:
    warnings: list[str] = []
    for candidate in (options.shell, inherited.get("SHELL")):
        if candidate:
            candidate = os.path.expanduser(candidate)
            if _executable(candidate):
                return os.path.abspath(candidate), tuple(warnings)
            warnings.append(
                "Configured shell is not executable"
                if options.shell == candidate
                else "SHELL does not point to an executable"
            )
    if platform != "win32":
        try:
            if sys.platform != "win32":
                import pwd

                candidate = pwd.getpwuid(os.getuid()).pw_shell
            else:
                candidate = ""
            if _executable(candidate):
                return candidate, tuple(warnings)
        except ImportError, KeyError, OSError:
            warnings.append("Account login shell unavailable")
        return "/bin/sh", tuple(warnings)
    return None, tuple(warnings)


def _shell_command(shell: str, helper: list[str]) -> tuple[list[str], str | None, str]:
    kind = Path(shell).stem.lower()
    if kind in {"pwsh", "powershell"}:
        command = "& " + " ".join("'" + arg.replace("'", "''") + "'" for arg in helper)
        # PowerShell loads profiles for -Command; -NonInteractive forbids prompts.
        return (
            [
                shell,
                *([] if os.name == "nt" else ["-Login"]),
                "-NoLogo",
                "-NonInteractive",
                "-Command",
                command,
            ],
            None,
            kind,
        )
    if kind in {"nu", "nushell"}:
        command = "^" + " ".join(json.dumps(arg, ensure_ascii=False) for arg in helper)
        return [shell, "--login", "--interactive", "--commands", command], None, kind
    command = " ".join(shlex.quote(arg) for arg in helper)
    if kind in {"csh", "tcsh"}:
        # csh forbids combining -l with -c. A leading '-' argv[0] selects login startup.
        command = " ".join(
            '"'
            + arg.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("$", "\\$")
            .replace("`", "\\`")
            .replace("!", "\\!")
            + '"'
            for arg in helper
        )
        return ["-" + kind, "-i", "-c", command], shell, kind
    # bash, zsh, fish, sh/dash, ksh, xonsh all accept these flags.
    return [shell, "-l", "-i", "-c", command], None, kind


def _terminate_probe(process: subprocess.Popen) -> None:
    if sys.platform != "win32":
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
    else:
        # Explicit PowerShell capture on Windows: also stop native children of its profile.
        taskkill = str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/taskkill.exe")
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            subprocess.run(
                [taskkill, "/PID", str(process.pid), "/T", "/F"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=3,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        with contextlib.suppress(OSError):
            process.kill()


def _probe(
    shell: str, home: str, inherited: Mapping[str, str], timeout: float
) -> tuple[dict[str, str], str | None, tuple[str, ...], str]:
    marker = "CODECHROMA_ENV_" + secrets.token_hex(24)
    if getattr(sys, "frozen", False):
        helper = [sys.executable, "--printenv", marker]
    else:
        helper = [sys.executable, "-I", str(Path(__file__).with_name("env_helper.py")), marker]
    argv, executable, kind = _shell_command(shell, helper)
    env = _clean(inherited)
    for name in (
        "DIRENV_DIR",
        "DIRENV_FILE",
        "DIRENV_DIFF",
        "DIRENV_WATCHES",
        "MISE_CONFIG_FILE",
        "MISE_PROJECT_ROOT",
    ):
        env.pop(name, None)
    env["PWD"] = home
    env["CODECHROMA_RESOLVING_ENVIRONMENT"] = "1"
    if getattr(sys, "frozen", False):
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    error = None
    warnings: list[str] = []
    # A file prevents noisy startup output from exhausting memory or filling a pipe.
    with tempfile.TemporaryFile() as output:
        try:
            process = subprocess.Popen(
                argv,
                executable=executable,
                cwd=home,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.DEVNULL,
                start_new_session=os.name != "nt",
                creationflags=(
                    getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                    | getattr(subprocess, "CREATE_NO_WINDOW", 0)
                )
                if os.name == "nt"
                else 0,
            )
            try:
                code = process.wait(timeout=timeout)
                if code:
                    warnings.append(f"Shell exited with status {code}")
            except subprocess.TimeoutExpired:
                error = "Shell environment capture timed out"
                _terminate_probe(process)
                process.wait()
            # Bound reads, and use the tail so startup banners cannot hide the helper.
            output.seek(0, os.SEEK_END)
            output.seek(max(0, output.tell() - 2_000_000))
            raw = output.read()
        except OSError:
            return {}, "Shell environment capture could not start", tuple(warnings), kind
    token = marker.encode()
    _, sep, payload = raw.partition(token)
    body, end, _ = payload.partition(token)
    if sep and end:
        try:
            captured = json.loads(body)
            if (
                isinstance(captured, dict)
                and all(
                    isinstance(k, str)
                    and k
                    and "=" not in k
                    and "\0" not in k
                    and isinstance(v, str)
                    and "\0" not in v
                    for k, v in captured.items()
                )
                and captured.get("PATH")
            ):
                if error:
                    warnings.append(error)
                return captured, None, tuple(warnings), kind
        except ValueError, UnicodeError:
            pass
    return {}, error or "Shell did not return a valid JSON environment", tuple(warnings), kind


class RuntimeEnvironment:
    """Thread-safe process-wide environment and generation-scoped CLI caches."""

    def __init__(
        self,
        options: RuntimeSettings | None = None,
        inherited: Mapping[str, str] | None = None,
        platform: str | None = None,
    ):
        self.options = options or load_runtime_settings()
        self._read_settings = options is None
        self.inherited = dict(os.environ if inherited is None else inherited)
        self.platform = platform or sys.platform
        self.home = self.inherited.get("HOME") or str(Path.home())
        self._lock = threading.RLock()
        self._future: Future[EnvironmentSnapshot] | None = None
        self._snapshot: EnvironmentSnapshot | None = None
        self._records: dict[tuple[str, str, int], ResolutionRecord] = {}
        self._last_capture = float("-inf")

    def start(self) -> Future[EnvironmentSnapshot]:
        with self._lock:
            if self._future is None:
                return self.refresh("startup", force=True)
            return self._future

    def snapshot(self) -> EnvironmentSnapshot:
        pending = self.start()
        with self._lock:
            current = self._snapshot
        # Refresh runs in the background; launches can keep using their immutable generation.
        return current if current is not None else pending.result()

    def refresh(self, reason: str, *, force: bool = False) -> Future[EnvironmentSnapshot]:
        with self._lock:
            if self._future is not None and not self._future.done():
                return self._future
            if not force and time.monotonic() - self._last_capture < 30 and self._future:
                return self._future
            self._last_capture = time.monotonic()
            if self._read_settings:
                self.options = load_runtime_settings()
            future: Future[EnvironmentSnapshot] = Future()
            self._future = future
            threading.Thread(
                target=self._capture, args=(future,), name="codechroma-environment", daemon=True
            ).start()
            return future

    def _capture(self, future: Future[EnvironmentSnapshot]) -> None:
        started = time.monotonic()
        captured: dict[str, str] = {}
        error = None
        warnings: tuple[str, ...] = ()
        shell = kind = None
        try:
            options = self.options
            if self.platform != "win32" or options.shell:
                shell, warnings = _select_shell(options, self.inherited, self.platform)
                if shell:
                    captured, error, probe_warnings, kind = _probe(
                        shell,
                        self.home,
                        self.inherited,
                        options.timeout_seconds,
                    )
                    warnings += probe_warnings
            inherited = _clean(self.inherited)
            exported = _clean(captured)
            merged = {**inherited, **exported}
            path = _path_entries(exported.get("PATH", ""), inherited.get("PATH", ""))
            if not captured:
                path = _path_entries(
                    os.pathsep.join(path), os.pathsep.join(_fallback_dirs(self.home, self.platform))
                )
            merged["PATH"] = os.pathsep.join(path)
            if shell:
                merged["SHELL"] = shell
            with self._lock:
                generation = self._snapshot.generation + 1 if self._snapshot else 1
                snapshot = EnvironmentSnapshot(
                    generation,
                    MappingProxyType(merged),
                    MappingProxyType(_clean(captured)),
                    path,
                    "login shell" if captured else "inherited environment + fallback locations",
                    shell,
                    kind,
                    time.time(),
                    time.monotonic() - started,
                    warnings,
                    error,
                )
                self._snapshot = snapshot
                self._records.clear()
            future.set_result(snapshot)
        except Exception as exc:
            # Do not strand callers or leak values from arbitrary exception messages.
            merged = _clean(self.inherited)
            path = _path_entries(
                merged.get("PATH", ""), os.pathsep.join(_fallback_dirs(self.home, self.platform))
            )
            merged["PATH"] = os.pathsep.join(path)
            with self._lock:
                generation = self._snapshot.generation + 1 if self._snapshot else 1
                snapshot = EnvironmentSnapshot(
                    generation,
                    MappingProxyType(merged),
                    MappingProxyType({}),
                    path,
                    "inherited environment + fallback locations",
                    shell,
                    kind,
                    time.time(),
                    time.monotonic() - started,
                    warnings,
                    f"Capture failed ({type(exc).__name__})",
                )
                self._snapshot = snapshot
                self._records.clear()
            future.set_result(snapshot)

    def spawn_env(
        self, extra: Mapping[str, str] | None = None, snapshot: EnvironmentSnapshot | None = None
    ) -> dict[str, str]:
        return _clean({**(snapshot or self.snapshot()).environment, **(extra or {})})

    def resolve(
        self, name: str, extra: Mapping[str, str] | None = None, *, recheck: bool = False
    ) -> RuntimeCli:
        snapshot = self.snapshot()
        env = self.spawn_env(extra, snapshot)
        configured = name if os.path.dirname(name) else self.options.cli_paths.get(name, name)
        expanded = os.path.expanduser(configured)
        key = (name, env.get("PATH", ""), snapshot.generation)
        now = time.time()
        with self._lock:
            record = self._records.get(key)
        # Validate positive entries so deleted launchers are never treated as installed.
        if record and not recheck and record.executable and _executable(record.executable):
            if record.source == "well-known executable location":
                env["PATH"] = os.pathsep.join(
                    _path_entries(
                        env.get("PATH", ""),
                        os.pathsep.join(_fallback_dirs(self.home, self.platform)),
                    )
                )
            return RuntimeCli(
                record.executable,
                MappingProxyType(env),
                record.source,
                snapshot.generation,
                record.timestamp,
                record.version,
            )
        if record and not recheck and record.failure_reason and now - record.timestamp < 3:
            raise CliLookupError(record.failure_reason)
        source = snapshot.source
        executable = shutil.which(expanded, path=env.get("PATH", ""))
        if os.path.dirname(expanded):
            source = "explicit executable path"
        elif not executable:
            fallback = os.pathsep.join(_fallback_dirs(self.home, self.platform))
            executable = shutil.which(expanded, path=fallback)
            if executable:
                source = "well-known executable location"
                # A launcher with /usr/bin/env node needs the fallback PATH at execution too.
                env["PATH"] = os.pathsep.join(_path_entries(env.get("PATH", ""), fallback))
        if executable:
            absolute = os.path.abspath(executable)  # intentionally not realpath()
            record = ResolutionRecord(name, absolute, source, snapshot.generation, now)
            with self._lock:
                self._records[key] = record
            return RuntimeCli(absolute, MappingProxyType(env), source, snapshot.generation, now)
        if os.path.dirname(expanded):
            reason = "does not exist" if not Path(expanded).exists() else "is not executable"
            message = f"Configured CLI path {configured!r} {reason}."
        else:
            message = (
                f"{name!r} executable not found on PATH ({source}). "
                "Install it, click Re-detect, or configure its executable path. "
                "Shell aliases/functions are not executable CLI paths."
            )
        record = ResolutionRecord(name, None, source, snapshot.generation, now, message)
        with self._lock:
            self._records[key] = record
        if not os.path.dirname(expanded) and self.platform != "win32":
            pending = self.refresh("unresolved CLI")
            if pending.done() and pending.result().generation != snapshot.generation:
                return self.resolve(name, extra, recheck=True)
        raise CliLookupError(message)

    def configure(self, options: RuntimeSettings) -> Future[EnvironmentSnapshot]:
        with self._lock:
            self.options = options
            self._records.clear()
        # Wait for any capture already in flight before recapturing the new settings.
        pending = self.start()
        pending.result()
        return self.refresh("settings changed", force=True)

    def launch_failed(self, exc: Exception) -> None:
        if isinstance(exc, OSError) and exc.errno in {errno.ENOENT, errno.EACCES}:
            with self._lock:
                self._records.clear()
            self.refresh("executable launch failed")

    def recheck_unresolved(self) -> EnvironmentSnapshot:
        snapshot = self.snapshot()
        with self._lock:
            names = {r.name for r in self._records.values() if r.failure_reason}
        for name in names:
            with contextlib.suppress(CliLookupError):
                self.resolve(name, recheck=True)
        if names:
            self.start().result()
            return self.snapshot()
        return snapshot

    def diagnose(self, name: str) -> dict:
        with contextlib.suppress(CliLookupError):
            self.resolve(name)
        with self._lock:
            records = [r for r in self._records.values() if r.name == name]
        record = max(records, key=lambda r: r.timestamp) if records else None
        return {
            "environment": self.snapshot().diagnostics(),
            "resolution": record.diagnostics() if record else None,
        }


_singleton: RuntimeEnvironment | None = None
_singleton_lock = threading.Lock()
_singleton_settings_path: Path | None = None


def get_runtime_environment() -> RuntimeEnvironment:
    global _singleton, _singleton_settings_path
    path = settings_path()
    with _singleton_lock:
        if _singleton is None or _singleton_settings_path != path:
            _singleton = RuntimeEnvironment()
            _singleton_settings_path = path
        return _singleton


def runtime_environment(overrides: Mapping[str, str] | None = None) -> tuple[dict[str, str], str]:
    runtime = get_runtime_environment()
    snapshot = runtime.snapshot()
    return runtime.spawn_env(overrides, snapshot), snapshot.source


def resolve_runtime_cli(binary: str, overrides: Mapping[str, str] | None = None) -> RuntimeCli:
    return get_runtime_environment().resolve(binary, overrides)


def cli_available(binary: str) -> bool:
    try:
        resolve_runtime_cli(binary)
        return True
    except CliLookupError:
        return False


def launch_failed(exc: Exception) -> None:
    get_runtime_environment().launch_failed(exc)
