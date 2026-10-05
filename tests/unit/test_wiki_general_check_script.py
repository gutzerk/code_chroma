"""check_wiki_general.py: manifest/page structure checks, plus the hallucinated-path failure."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from codechroma.io import load_module_from_path

SKILL = (
    Path(__file__).parent.parent.parent
    / ".claude"
    / "skills"
    / "codechroma-wiki-general-update"
)
SCRIPT = SKILL / "scripts" / "check_wiki_general.py"


def _load_module():
    """Imports the script by path so a test can monkeypatch its urlopen without a live bridge."""
    return load_module_from_path("check_wiki_general", SCRIPT)


def _write_tree(root: Path, *, manifest: dict, pages: dict[str, str]) -> None:
    wiki_general = root / ".codechroma" / "wiki-general"
    wiki_general.mkdir(parents=True, exist_ok=True)
    (wiki_general / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for relative_path, content in pages.items():
        page = wiki_general / relative_path
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text(content, encoding="utf-8")


def _valid_manifest() -> dict:
    return {
        "generated_at": "2026-09-14T00:00:00Z",
        "containers": [{"id": "backend", "name": "Backend", "path": "c2/backend.md"}],
        "components": [
            {"id": "auth", "name": "Authentication", "container": "backend", "path": "c3/auth.md"}
        ],
    }


def _connects_manifest() -> dict:
    """A second container/component pair plus a real edge, for the Connects: grounding tests."""
    manifest = _valid_manifest()
    manifest["containers"].append({"id": "frontend", "name": "Frontend", "path": "c2/frontend.md"})
    manifest["components"].append(
        {"id": "billing", "name": "Billing", "container": "frontend", "path": "c3/billing.md"}
    )
    manifest["edges"] = [{"from": "auth", "to": "billing", "count": 2}]
    return manifest


def _connects_pages(auth_connects: str) -> dict:
    pages = _valid_pages()
    pages["c3/auth.md"] = (
        "# Authentication\n\n## Elements\n\n"
        "- **Users** — conceptual, no code reference.\n\n"
        f"## Connections\n\n{auth_connects}\n"
    )
    pages["c2/frontend.md"] = (
        "# Frontend\n\n## Components\n\n- [Billing](../c3/billing.md) — billing.\n"
    )
    pages["c3/billing.md"] = "# Billing\n\n## Elements\n\n- **Charges** — conceptual.\n"
    pages["index.md"] += "- [Frontend](c2/frontend.md) — the frontend.\n"
    return pages


def _valid_pages(auth_elements: str = "- **Users** — conceptual, no code reference.") -> dict:
    return {
        "index.md": "# Sample\n\n## Containers\n\n- [Backend](c2/backend.md) — the backend.\n",
        "c2/backend.md": (
            "# Backend\n\n## Components\n\n- [Authentication](../c3/auth.md) — auth.\n"
        ),
        "c3/auth.md": f"# Authentication\n\n## Elements\n\n{auth_elements}\n",
    }


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._data = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._data

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *exc: object) -> bool:
        return False


def _run(tmp_path: Path, *extra: str) -> subprocess.CompletedProcess:
    argv = [sys.executable, str(SCRIPT), "--dir", str(tmp_path), *extra]
    return subprocess.run(argv, capture_output=True, text=True)


def test_ok_when_the_tree_is_consistent_and_no_element_carries_a_code_reference(tmp_path):
    _write_tree(tmp_path, manifest=_valid_manifest(), pages=_valid_pages())

    result = _run(tmp_path)

    assert result.returncode == 0
    assert "OK:" in result.stdout


def test_missing_manifest_is_an_error(tmp_path):
    result = _run(tmp_path)

    assert result.returncode == 2


def test_duplicate_container_id_fails(tmp_path):
    manifest = _valid_manifest()
    manifest["containers"].append({"id": "backend", "name": "Backend 2", "path": "c2/b2.md"})
    _write_tree(tmp_path, manifest=manifest, pages=_valid_pages())

    result = _run(tmp_path)

    assert result.returncode == 1
    assert "DUPLICATE container id 'backend'" in result.stdout


def test_dangling_component_container_fails(tmp_path):
    manifest = _valid_manifest()
    manifest["components"][0]["container"] = "frontend"
    _write_tree(tmp_path, manifest=manifest, pages=_valid_pages())

    result = _run(tmp_path)

    assert result.returncode == 1
    assert "DANGLING component 'auth' names container 'frontend'" in result.stdout


def test_empty_container_fails(tmp_path):
    manifest = _valid_manifest()
    manifest["containers"].append({"id": "empty", "name": "Empty", "path": "c2/empty.md"})
    pages = _valid_pages()
    pages["c2/empty.md"] = "# Empty\n\n## Components\n"
    pages["index.md"] += "- [Empty](c2/empty.md) — nothing here.\n"
    _write_tree(tmp_path, manifest=manifest, pages=pages)

    result = _run(tmp_path)

    assert result.returncode == 1
    assert "EMPTY-CONTAINER 'empty' has no components" in result.stdout


def test_missing_page_fails(tmp_path):
    pages = _valid_pages()
    del pages["c3/auth.md"]
    _write_tree(tmp_path, manifest=_valid_manifest(), pages=pages)

    result = _run(tmp_path)

    assert result.returncode == 1
    assert "MISSING-PAGE c3 page" in result.stdout


def test_link_missing_is_advisory_and_does_not_fail(tmp_path):
    pages = _valid_pages()
    pages["index.md"] = "# Sample\n\n## Containers\n\n(nothing linked yet)\n"
    _write_tree(tmp_path, manifest=_valid_manifest(), pages=pages)

    result = _run(tmp_path)

    assert result.returncode == 0
    assert "LINK-MISSING root page never links to c2/backend.md" in result.stdout


def test_the_default_relative_dir_still_reports_link_missing(tmp_path):
    """The skill runs this from the repo root with no --dir, so `.` must behave like an abs path."""
    pages = _valid_pages()
    pages["index.md"] = "# Sample\n\n## Containers\n\n(nothing linked yet)\n"
    _write_tree(tmp_path, manifest=_valid_manifest(), pages=pages)

    result = subprocess.run(
        [sys.executable, str(SCRIPT)], capture_output=True, text=True, cwd=tmp_path
    )

    assert result.returncode == 0
    assert "LINK-MISSING root page never links to c2/backend.md" in result.stdout


def test_valid_code_reference_resolves_and_passes(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(
        module.urllib.request,
        "urlopen",
        lambda url, timeout=10: _FakeResponse({"has_wiki": True, "gaps": []}),
    )
    elements = "- **Token Validation** — validates tokens.\n  - File: `src/auth/token.py`"
    _write_tree(tmp_path, manifest=_valid_manifest(), pages=_valid_pages(elements))

    exit_code = module.main(["--dir", str(tmp_path)])

    assert exit_code == 0


def test_hallucinated_code_reference_fails(tmp_path, monkeypatch, capsys):
    module = _load_module()
    monkeypatch.setattr(
        module.urllib.request,
        "urlopen",
        lambda url, timeout=10: _FakeResponse(
            {"has_wiki": True, "gaps": ["src/does/not/exist.py"]}
        ),
    )
    elements = "- **Ghost** — invented.\n  - File: `src/does/not/exist.py`"
    _write_tree(tmp_path, manifest=_valid_manifest(), pages=_valid_pages(elements))

    exit_code = module.main(["--dir", str(tmp_path)])

    assert exit_code == 1
    assert "HALLUCINATED 'src/does/not/exist.py'" in capsys.readouterr().out


@pytest.mark.parametrize(
    "tag,path",
    [("Class", "src/auth/session.py::SessionManager"), ("Function", "src/auth/token.py::check")],
)
def test_class_and_function_references_strip_the_symbol_before_checking(
    tmp_path, monkeypatch, tag, path
):
    module = _load_module()
    seen_paths = []

    def _fake_urlopen(url, timeout=10):
        seen_paths.append(url)
        return _FakeResponse({"has_wiki": True, "gaps": []})

    monkeypatch.setattr(module.urllib.request, "urlopen", _fake_urlopen)
    elements = f"- **Thing** — a thing.\n  - {tag}: `{path}`"
    _write_tree(tmp_path, manifest=_valid_manifest(), pages=_valid_pages(elements))

    exit_code = module.main(["--dir", str(tmp_path)])

    assert exit_code == 0
    assert path.split("::")[0] in seen_paths[0]
    assert "::" not in seen_paths[0]


def test_grounded_connects_line_passes(tmp_path):
    pages = _connects_pages("- Connects: `billing`")
    _write_tree(tmp_path, manifest=_connects_manifest(), pages=pages)

    result = _run(tmp_path)

    assert result.returncode == 0
    assert "OK:" in result.stdout


def test_invented_connects_target_fails(tmp_path):
    pages = _connects_pages("- Connects: `nonexistent`")
    _write_tree(tmp_path, manifest=_connects_manifest(), pages=pages)

    result = _run(tmp_path)

    assert result.returncode == 1
    assert "CONNECTS-INVALID 'auth' claims a connection to 'nonexistent'" in result.stdout


def test_a_real_edge_the_text_omits_is_not_flagged(tmp_path):
    pages = _connects_pages("")  # auth<->billing is real, but never claimed on the page
    _write_tree(tmp_path, manifest=_connects_manifest(), pages=pages)

    result = _run(tmp_path)

    assert result.returncode == 0
    assert "OK:" in result.stdout


def test_strip_connects_removes_a_still_invalid_line_then_the_run_passes_clean(tmp_path):
    pages = _connects_pages("- Connects: `nonexistent`")
    _write_tree(tmp_path, manifest=_connects_manifest(), pages=pages)

    first = _run(tmp_path)
    assert first.returncode == 1
    assert "CONNECTS-INVALID" in first.stdout

    strip_result = _run(tmp_path, "--strip-connects", "c3/auth.md", "nonexistent")
    assert strip_result.returncode == 0
    assert "STRIPPED" in strip_result.stdout

    second = _run(tmp_path)
    assert second.returncode == 0
    assert "OK:" in second.stdout


def test_strip_connects_reports_an_error_when_no_matching_line_exists(tmp_path):
    pages = _connects_pages("- Connects: `billing`")
    _write_tree(tmp_path, manifest=_connects_manifest(), pages=pages)

    result = _run(tmp_path, "--strip-connects", "c3/auth.md", "nonexistent")

    assert result.returncode == 2
