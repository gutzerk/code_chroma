"""packaging/bridge_main.py must export the port it actually bound, not assume 8000."""

import importlib.util
from pathlib import Path

import uvicorn

_BRIDGE_MAIN_PATH = Path(__file__).resolve().parents[2] / "packaging" / "bridge_main.py"


def _load_bridge_main():
    spec = importlib.util.spec_from_file_location("bridge_main", _BRIDGE_MAIN_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_main_exports_codechroma_bridge_url_with_the_bound_port(bridge_repo, monkeypatch):
    module = _load_bridge_main()
    monkeypatch.setattr(uvicorn, "run", lambda *args, **kwargs: None)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    module.main(["--repo-path", str(bridge_repo), "--port", "54893"])

    assert module.os.environ["codechroma_BRIDGE_URL"] == "http://127.0.0.1:54893"
