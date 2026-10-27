# ruff: noqa: E501
"""Replays tests/fixtures/bridge_contract/*.cases.json against the FastAPI bridge (the reference)."""

from __future__ import annotations

import base64
import json
import queue
import shutil
import threading
from contextlib import ExitStack
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from codechroma.bridge.app import create_app
from tests.conftest import FIXTURE_REPO, init_repo
from tests.contract.bridge_contract import (
    expectation_failures,
    load_cases,
    select,
    substitute_variables,
)

CASES = load_cases()
USER_STORE_ENV = {
    "codechroma_ASSISTANT_SETTINGS_FILE": "assistant-settings.json",
    "codechroma_RUNTIME_SETTINGS_FILE": "runtime-environment.json",
    "codechroma_LLM_PROVIDERS_FILE": "llm-providers.json",
    "codechroma_LLM_CALL_SITE_SETTINGS_FILE": "llm-call-site-settings.json",
    "codechroma_DIAGRAM_TYPES_DIR": "diagram-types",
}
SUPPORTED = {"real-engine", "diagram-resolver", "terminal-frames", "pty"}


def _prepare(repo_spec: dict):
    files = repo_spec.get("files", {})

    def prepare(repo: Path) -> None:
        for name, content in files.items():
            target = repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(
                base64.b64decode(content["base64"])
                if "base64" in content
                else content["text"].encode()
            )

    return prepare


class _Socket:
    """A live WebSocket whose receives can time out, which TestClient's own cannot."""

    def __init__(self, session) -> None:
        self.session = session
        self.frames: queue.Queue = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self) -> None:
        while True:
            try:
                self.frames.put(("text", self.session.receive_text()))
            except WebSocketDisconnect as closed:
                self.frames.put(("close", closed.code))
                return
            except Exception as error:
                self.frames.put(("error", repr(error)))
                return

    def next(self, timeout_s: float):
        return self.frames.get(timeout=timeout_s)


def _run_http(client: TestClient, spec: dict, repo: str, variables: dict) -> list[str]:
    request = spec["http"]
    response = client.request(
        request["method"],
        request["path"],
        params=request.get("query"),
        headers=request.get("headers"),
        json=request.get("json"),
    )
    expect = spec.get("expect", {})
    failures = []
    if "status" in expect and response.status_code != expect["status"]:
        failures.append(
            f"status {response.status_code} != {expect['status']}: {response.text[:300]}"
        )
    if "json" in expect or "checks" in expect:
        failures.extend(expectation_failures(expect, response.json(), repo))
    for name, path in spec.get("capture", {}).items():
        values, _ = select(response.json(), path)
        variables[name] = str(values[0]) if values else ""
    return failures


def _run_fs(spec: dict, root: Path) -> None:
    target = root / spec["path"]
    if spec["fs"] == "write":
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(
            base64.b64decode(spec["base64"]) if "base64" in spec else spec["text"].encode()
        )
    elif spec["fs"] == "delete":
        target.unlink(missing_ok=True)
    else:
        target.write_text(
            target.read_text(encoding="utf-8").replace(spec["find"], spec["with"]), encoding="utf-8"
        )


def _run_ws(
    client: TestClient, spec: dict, sockets: dict, stack: ExitStack, repo: str
) -> list[str]:
    action = spec["ws"]
    if action == "connect":
        try:
            session = stack.enter_context(
                client.websocket_connect(spec["path"], headers=dict(spec.get("headers") or {}))
            )
        except WebSocketDisconnect:
            return [] if spec.get("expect") == "rejected" else ["websocket handshake was refused"]
        if spec.get("expect") == "rejected":
            return ["websocket handshake was accepted, wanted rejected"]
        sockets[spec["name"]] = _Socket(session)
        return []
    socket = sockets[spec["name"]]
    if action == "send":
        socket.session.send_json(spec["json"])
        return []
    deadline = spec.get("timeout_ms", 8000) / 1000
    if action == "expect_close":
        kind, value = socket.next(deadline)
        return (
            []
            if (kind, value) == ("close", spec["code"])
            else [f"wanted close {spec['code']}, got {kind} {value}"]
        )
    failures: list[str] = []
    while True:
        try:
            kind, value = socket.next(deadline)
        except queue.Empty:
            return [*failures, "timed out waiting for a frame"]
        if kind != "text":
            return [*failures, f"socket ended with {kind} {value}"]
        tag = spec.get("tag")
        if tag and not value.startswith(tag):
            failures = [f"frame tag {value[:1]!r} != {tag!r}"]
            continue
        if spec.get("raw"):
            return failures
        body = json.loads(value[len(tag) :] if tag else value)
        failures = expectation_failures(spec.get("expect", {}), body, repo)
        if not failures or not spec.get("skip_until_match"):
            return failures


def _read_only(case: dict) -> bool:
    return all("http" in step and step["http"]["method"] == "GET" for step in case["steps"])


@pytest.fixture(autouse=True)
def no_live_cli_probe(monkeypatch):
    """Cases assume the built-in model lists, so a machine's own CLI must never answer."""
    monkeypatch.setattr("codechroma.llm.model_catalog._probe_cli_models", lambda _adapter: None)


@pytest.fixture
def user_stores(tmp_path, monkeypatch):
    """Points every machine-local settings store at an empty temp dir, so cases never share state."""
    stores = tmp_path / "user-stores"
    for env, name in USER_STORE_ENV.items():
        monkeypatch.setenv(env, str(stores / name))
    return stores


@pytest.fixture(scope="module")
def shared_bridges(tmp_path_factory):
    """One analyzed app per distinct repo spec, for cases that only issue GETs."""
    cache: dict[str, tuple] = {}
    stack = ExitStack()

    def get(repo_spec: dict):
        key = json.dumps(repo_spec, sort_keys=True)
        if key not in cache:
            repo = tmp_path_factory.mktemp("contract") / "repo"
            shutil.copytree(FIXTURE_REPO, repo)
            _prepare(repo_spec)(repo)
            init_repo(repo)
            with pytest.MonkeyPatch.context() as patch:
                patch.setenv("ANTHROPIC_API_KEY", "")
                app = create_app(repo)
            cache[key] = (stack.enter_context(TestClient(app)), repo)
        return cache[key]

    yield get
    stack.close()


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_wire_contract(case, make_repo, make_bridge, shared_bridges, user_stores):
    missing = set(case.get("requires", [])) - SUPPORTED
    if missing:
        pytest.skip(f"backend lacks {sorted(missing)}")
    if _read_only(case):
        shared_client, repo = shared_bridges(case["repo"])
    else:
        repo = make_repo(_prepare(case["repo"]))
        shared_client = None
    failures: list[str] = []
    sockets: dict = {}
    variables: dict[str, str] = {}

    with ExitStack() as stack:
        client = shared_client or stack.enter_context(TestClient(make_bridge(repo).app))
        for number, raw_step in enumerate(case["steps"], start=1):
            step = substitute_variables(raw_step, variables)
            if "http" in step:
                found = _run_http(client, step, str(repo), variables)
            elif "fs" in step:
                _run_fs(step, repo)
                found = []
            else:
                found = _run_ws(client, step, sockets, stack, str(repo))
            failures.extend(f"step {number}: {message}" for message in found)
            if found:
                break

    assert not failures, "\n".join(failures)
