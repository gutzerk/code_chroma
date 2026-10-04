"""wiki_general_pipeline.py: deterministic rendering helpers, and one end-to-end run_pipeline()."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from codechroma.bridge import wiki_general_pipeline as pipeline
from codechroma.dependencies.digest import _FileSymbols
from codechroma.graph.models import Graph, Symbol, SymbolKind
from codechroma.llm.cli_adapters import ClaudeAdapter
from tests.unit.fake_worker_claude import fake_worker_exec


class _FakeAgent:
    """Just enough of `SkillAgent` for `run_pipeline`/`run_worker_job` to run against."""

    def __init__(self):
        self.name = "wiki_general_agent"
        self.job_procs: dict[str, set] = {}

    def resolve_cli(self):
        return ClaudeAdapter(), "claude", "haiku", {}

    def register_job_proc(self, repo_id, proc) -> None:
        self.job_procs.setdefault(repo_id, set()).add(proc)

    def unregister_job_proc(self, repo_id, proc) -> None:
        self.job_procs.get(repo_id, set()).discard(proc)


def test_render_c3_page_matches_check_wiki_general_format():
    elements = [
        {
            "name": "login",
            "description": "Logs a user in.",
            "file": "app/auth.py",
            "function_name": "login",
        },
        {"name": "Notion", "description": "No code reference."},
    ]

    page = pipeline._render_c3_page("Auth", "Handles login.", elements, {"billing"})

    assert page.startswith("# Auth\n\nHandles login.\n\n## Elements\n")
    assert "- **login** — Logs a user in." in page
    assert "  - File: `app/auth.py`" in page
    assert "  - Function: `app/auth.py::login`" in page
    assert "## Connections" in page
    assert "- Connects: `billing`" in page


def test_render_c3_page_omits_connections_section_with_no_neighbors():
    page = pipeline._render_c3_page("Auth", "Handles login.", [], set())

    assert "## Connections" not in page


def test_render_c2_page_links_components_relative_to_c3():
    components = [("auth", "Auth", "Handles login.")]

    page = pipeline._render_c2_page("Backend", "The API server.", components, set())

    assert "- [Auth](../c3/auth.md) — Handles login" in page


def test_render_index_links_containers_relative_to_c2():
    containers = [("backend", "Backend", "The API server.")]

    page = pipeline._render_index("demo-repo", "A demo system.", containers)

    assert page.startswith("# demo-repo — Architecture Map\n\nA demo system.\n\n## Containers\n")
    assert "- [Backend](c2/backend.md) — The API server" in page


def _symbol(id_: str, name: str, kind: SymbolKind, docstring=None, parent_symbol_id=None) -> Symbol:
    return Symbol(
        id=id_, file_path="app/auth.py", kind=kind, name=name, qualified_name=name,
        start_line=1, end_line=2, language="python", parent_symbol_id=parent_symbol_id,
        docstring=docstring,
    )


def _by_path(path="app/auth.py", classes=(), methods_by_class_id=None, functions=()) -> dict:
    """One-file `_deterministic_elements` input, `module=None` -- no test here reads it."""
    entry = _FileSymbols(
        path=path, module=None, classes=list(classes),
        methods_by_class_id=methods_by_class_id or {}, functions=list(functions),
    )
    return {path: entry}


def test_deterministic_elements_covers_classes_methods_and_functions():
    cls = _symbol("c1", "Auth", SymbolKind.CLASS, "Auth handles login.")
    method = _symbol("m1", "login", SymbolKind.FUNCTION, "Logs a user in.", parent_symbol_id="c1")
    func = _symbol("f1", "helper", SymbolKind.FUNCTION, "A helper.")
    by_path = _by_path(classes=[cls], methods_by_class_id={"c1": [method]}, functions=[func])

    elements = pipeline._deterministic_elements(by_path, ["app/auth.py"])

    shapes = {(e["name"], e["class_name"], e["function_name"]) for e in elements}
    assert shapes == {
        ("Auth", "Auth", None), ("login", "Auth", "login"), ("helper", None, "helper")
    }


def test_deterministic_elements_trims_a_docstring_to_its_first_sentence():
    cls = _symbol("c1", "Auth", SymbolKind.CLASS, "Auth handles login. Extra detail.")
    by_path = _by_path(classes=[cls], methods_by_class_id={"c1": []})

    elements = pipeline._deterministic_elements(by_path, ["app/auth.py"])

    assert elements[0]["description"] == "Auth handles login."


def test_deterministic_elements_collapses_a_line_wrapped_docstring_to_one_line():
    cls = _symbol("c1", "Auth", SymbolKind.CLASS, "Auth handles login.\nWraps across source lines.")
    by_path = _by_path(classes=[cls], methods_by_class_id={"c1": []})

    elements = pipeline._deterministic_elements(by_path, ["app/auth.py"])

    assert "\n" not in elements[0]["description"]


def test_deterministic_elements_falls_back_to_the_no_docstring_placeholder():
    func = _symbol("f1", "helper", SymbolKind.FUNCTION, docstring=None)
    by_path = _by_path(functions=[func])

    elements = pipeline._deterministic_elements(by_path, ["app/auth.py"])

    assert elements[0]["description"] == "*no docstring*"


def test_deterministic_elements_skips_a_file_with_no_parsed_symbols():
    elements = pipeline._deterministic_elements({}, ["app/missing.py"])

    assert elements == []


def test_deterministic_elements_skips_test_files():
    func = _symbol("f1", "helper", SymbolKind.FUNCTION, "A helper.")
    by_path = _by_path(path="app/auth_test.go", functions=[func])

    elements = pipeline._deterministic_elements(by_path, ["app/auth_test.go"])

    assert elements == []


@pytest.mark.parametrize(
    "path",
    [
        "pkg/vllm_test.go",
        "app/test_auth.py",
        "app/auth_test.py",
        "web/src/Login.test.ts",
        "web/src/Login.spec.tsx",
        "com/app/TestAuth.java",
        "com/app/AuthTest.java",
    ],
)
def test_is_test_file_recognizes_common_per_language_conventions(path):
    assert pipeline._is_test_file(path) is True


@pytest.mark.parametrize("path", ["pkg/vllm.go", "app/auth.py", "web/src/Login.tsx"])
def test_is_test_file_leaves_real_source_files_alone(path):
    assert pipeline._is_test_file(path) is False


def test_resolve_undetermined_assignments_uses_models_valid_pick():
    data = {"assignments": [{"file": "app/misc.py", "component_id": "auth"}]}

    extra = pipeline._resolve_undetermined_assignments(
        ["app/misc.py"], {"app/misc.py": ["auth", "billing"]}, data
    )

    assert extra == {"auth": ["app/misc.py"]}


def test_resolve_undetermined_assignments_falls_back_to_first_candidate_on_invalid_pick():
    data = {"assignments": [{"file": "app/misc.py", "component_id": "not-a-real-id"}]}

    extra = pipeline._resolve_undetermined_assignments(
        ["app/misc.py"], {"app/misc.py": ["auth", "billing"]}, data
    )

    assert extra == {"auth": ["app/misc.py"]}


def _respond(prompt: str, required: list[str]) -> dict:
    if "narrative" in required:
        return {"narrative": "A small demo backend."}
    return {"summary": "The backend.", "description": "Serves the API."}


def test_run_pipeline_writes_manifest_and_pages_and_passes_self_check(
    tmp_path, monkeypatch, use_test_runtime
):
    from codechroma.llm.runtime_env import RuntimeCli

    runtime = use_test_runtime()
    monkeypatch.setattr(
        "codechroma.bridge.wiki_general_worker.resolve_runtime_cli",
        lambda binary, env: RuntimeCli(binary, runtime.spawn_env(env), "test"),
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_worker_exec(_respond))
    monkeypatch.setattr(
        pipeline,
        "compute_clustering",
        lambda ws: {
            "components": [{"id": "c1", "files": ["app/auth/login.py"]}],
            "containers": [{"id": "g1", "component_ids": ["c1"]}],
            "component_edges": [],
            "container_edges": [],
            "undetermined_files": [],
            "undetermined_candidates": {},
        },
    )
    (tmp_path / ".codechroma" / "wiki-general" / "c2").mkdir(parents=True)
    (tmp_path / ".codechroma" / "wiki-general" / "c3").mkdir(parents=True)
    engine = SimpleNamespace(snapshot=lambda: Graph())
    workspace = SimpleNamespace(root=tmp_path, engine=engine)
    agent = _FakeAgent()

    result = asyncio.run(pipeline.run_pipeline(agent, workspace, "default", None))

    assert result == {"state": "idle", "error": None}
    manifest = json.loads((tmp_path / ".codechroma" / "wiki-general" / "manifest.json").read_text())
    assert manifest["components"][0]["id"] == "auth"
    assert manifest["containers"][0]["id"] == "app"
    assert (tmp_path / ".codechroma" / "wiki-general" / "c3" / "auth.md").is_file()
    assert (tmp_path / ".codechroma" / "wiki-general" / "c2" / "app.md").is_file()
    assert (tmp_path / ".codechroma" / "wiki-general" / "index.md").is_file()


def test_run_pipeline_rejects_adapter_without_minimal_context_support(tmp_path):
    class _NoWorkerAdapter:
        def build_argv(self, binary, prompt, model):
            return [binary]

        def parse_line(self, raw, repo_root):
            return []

    class _NoWorkerAgent(_FakeAgent):
        def resolve_cli(self):
            return _NoWorkerAdapter(), "codex", "gpt", {}

    workspace = SimpleNamespace(root=tmp_path)

    result = asyncio.run(pipeline.run_pipeline(_NoWorkerAgent(), workspace, "default", None))

    assert result["state"] == "error"
    assert "does not support minimal-context workers" in result["error"]


def test_run_pipeline_requires_a_workspace():
    result = asyncio.run(pipeline.run_pipeline(_FakeAgent(), None, "default", None))

    assert result == {"state": "error", "error": "wiki-general pipeline requires a workspace"}
