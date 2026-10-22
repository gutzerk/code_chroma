"""Agent env identity, skill check scripts reading it, wiki-context truncation, update naming."""

import importlib.util
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from codechroma.bridge.wiki_context import build_wiki_context
from codechroma.bridge.wiki_general_agent import _diff_manifest
from codechroma.bridge.wiki_general_naming import assign_ids, unique_display
from codechroma.config import Settings, WikiContextConfig
from codechroma.dependencies.clustering import ClusterResult, ComponentCluster, ContainerCluster
from codechroma.io import load_module_from_path
from codechroma.questions.launch import identity_env

SKILLS = Path(__file__).parent.parent.parent / "skills"
DRAW = SKILLS / "codechroma-draw-diagram" / "scripts" / "check_diagram.py"
REVIEW = SKILLS / "codechroma-review-diagram" / "scripts" / "check_review.py"
WIKI = SKILLS / "codechroma-wiki-general-update" / "scripts" / "check_wiki_general.py"


def _load_draw():
    spec = importlib.util.spec_from_file_location("check_diagram", DRAW)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_diagram"] = module
    spec.loader.exec_module(module)
    return module


def test_identity_env_exports_the_uppercase_workspace_id_and_the_bridge_url(monkeypatch):
    monkeypatch.setenv("CODECHROMA_BRIDGE_URL", "http://127.0.0.1:51802/")

    env = identity_env("agent1")

    assert env == {
        "CODECHROMA_WORKSPACE_ID": "agent1",
        "CODECHROMA_BRIDGE_URL": "http://127.0.0.1:51802",
    }


def test_wiki_check_script_reads_the_bridge_url_and_workspace_from_the_environment(monkeypatch):
    monkeypatch.setenv("CODECHROMA_BRIDGE_URL", "http://127.0.0.1:51802")
    monkeypatch.setenv("CODECHROMA_WORKSPACE_ID", "agent1")
    module = load_module_from_path("check_wiki_general_env", WIKI)

    args = module._parse_args([])

    assert (args.url, args.repo) == ("http://127.0.0.1:51802", "agent1")


def test_wiki_check_script_falls_back_to_the_defaults_when_the_variables_are_empty(monkeypatch):
    monkeypatch.setenv("CODECHROMA_BRIDGE_URL", "")
    monkeypatch.delenv("CODECHROMA_WORKSPACE_ID", raising=False)
    module = load_module_from_path("check_wiki_general_env2", WIKI)

    args = module._parse_args([])

    assert (args.url, args.repo) == ("http://localhost:8000", "default")


def test_diagram_and_review_check_scripts_read_the_same_variables(monkeypatch):
    monkeypatch.setenv("CODECHROMA_BRIDGE_URL", "http://127.0.0.1:51802")
    monkeypatch.setenv("CODECHROMA_WORKSPACE_ID", "agent1")
    draw = _load_draw()
    review = load_module_from_path("check_review_env", REVIEW)

    draw_args = draw._parse_args(["--kind", "c1"])
    review_args = review._parse_args(["--kind", "impact"])

    assert (draw_args.url, draw_args.repo) == ("http://127.0.0.1:51802", "agent1")
    assert (review_args.url, review_args.repo) == ("http://127.0.0.1:51802", "agent1")


def test_wiki_check_asks_again_for_pages_the_size_cap_omitted(monkeypatch):
    module = load_module_from_path("check_wiki_general_omit", WIKI)
    requests = []

    class _Response:
        def __init__(self, body):
            self._body = body

        def read(self):
            return json.dumps(self._body).encode()

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def fake_urlopen(url, timeout):
        requests.append(url)
        if "a.py%2Cb.py" in url or "a.py,b.py" in url:
            return _Response({"gaps": [], "omitted": ["b.py"], "truncated": True})
        return _Response({"gaps": ["b.py"]})

    monkeypatch.setattr(module.urllib.request, "urlopen", fake_urlopen)

    gaps = module._http_gap_fetcher("http://bridge", "main")(["a.py", "b.py"])

    assert gaps == {"b.py"}
    assert len(requests) == 2


def test_a_dropped_relation_fails_the_diagram_check_but_a_dropped_node_only_advises():
    module = _load_draw()
    report = module._Report()
    diagram = {"diagnostics": {"dropped_count": 2, "truncated": False, "dropped": [
        {"what": "relation", "id": "a -> a", "reason": "self_relation"},
        {"what": "node", "id": "x", "reason": "duplicate_sibling_id"},
    ]}}

    module._check_diagnostics(diagram, report)

    assert report.broken == [
        "DROPPED relation a -> a self_relation -- the bridge discarded it, "
        "so it is not on the canvas"
    ]
    assert report.advisories == ["DROPPED node x duplicate_sibling_id"]


def test_the_sequence_kind_reports_no_cycle_or_articulation_advisories(tmp_path):
    module = _load_draw()
    diagram = {
        "type": "sequence",
        "nodes": [{"id": n, "name": n, "description": "d"} for n in "abc"],
        "relations": [
            {"id": "m1", "from": "a", "to": "b", "label": "x", "order": "1"},
            {"id": "m2", "from": "b", "to": "a", "label": "y", "order": "2"},
            {"id": "m3", "from": "b", "to": "c", "label": "z", "order": "3"},
            {"id": "m4", "from": "c", "to": "c", "label": "self", "order": "4"},
        ],
    }
    path = tmp_path / "sequence.json"
    path.write_text(json.dumps(diagram), encoding="utf-8")
    args = module._parse_args(["--kind", "sequence", "--json", str(path)])

    checks = module._resolve_checks(args, None)

    report = module._inspect_flat(diagram, checks, args)

    assert not any(line.startswith(("CYCLES", "ARTICULATION")) for line in report.advisories)
    assert report.broken == []


def test_the_sequence_route_keeps_a_participants_message_to_itself(bridge):
    directory = bridge.repo / ".codechroma" / "diagrams" / "sequence"
    directory.mkdir(parents=True)
    (directory / "sequence.json").write_text(json.dumps({
        "nodes": [{"id": "wf", "name": "Workflow", "description": "d"}],
        "relations": [{"id": "m1", "from": "wf", "to": "wf", "label": "guard", "order": "1"}],
    }), encoding="utf-8")

    with TestClient(bridge.app) as client:
        resolved = client.get("/repos/default/sequence").json()

    assert [r["id"] for r in resolved["relations"]] == ["m1"]
    assert resolved["diagnostics"]["dropped_count"] == 0


def _wiki(tmp_path: Path) -> Path:
    wiki_dir = tmp_path / "wiki"
    (wiki_dir / "files" / "src").mkdir(parents=True)
    (wiki_dir / "index.md").write_text("# root\n", encoding="utf-8")
    for name in ("a", "b", "c"):
        (wiki_dir / "files" / "src" / f"{name}.md").write_text(f"# {name}\n" * 8, encoding="utf-8")
    return wiki_dir


def test_wiki_context_names_the_requested_paths_the_size_cap_cut_off(tmp_path, monkeypatch):
    wiki_dir = _wiki(tmp_path)
    monkeypatch.setattr(
        "codechroma.bridge.wiki_context.settings",
        Settings(wiki_context=WikiContextConfig(max_chars=len("# root\n") + 20)),
    )

    bundle = build_wiki_context(wiki_dir, ["src/a.py", "src/b.py"])

    assert bundle.truncated is True
    assert bundle.gaps == []
    assert "src/b.py" in bundle.omitted
    assert bundle.warning is not None and "request them again" in bundle.warning


def test_wiki_context_without_truncation_has_no_omitted_paths_or_warning(tmp_path):
    bundle = build_wiki_context(_wiki(tmp_path), ["src/a.py"])

    assert (bundle.omitted, bundle.warning) == ([], None)


def test_two_same_named_groups_get_distinct_display_names():
    groups = [("g1", ["app/auth/x.py"]), ("g2", ["lib/auth/y.py"])]

    resolved = assign_ids(groups, top_level=False)

    assert resolved["g1"] == ("auth", "Auth")
    assert resolved["g2"] == ("auth-2", "Auth 2")
    assert unique_display("Auth", "auth", "auth") == "Auth"


def test_an_update_reuses_the_id_of_a_component_that_no_longer_exists():
    old_manifest = {
        "containers": [{"id": "src", "name": "Src", "files": ["a/rbac/x.py", "b/other/y.py"]}],
        "components": [
            {"id": "rbac", "name": "Rbac", "container": "src", "files": ["a/rbac/x.py"]},
            {"id": "other", "name": "Other", "container": "src", "files": ["b/other/y.py"]},
        ],
        "edges": [],
    }
    fresh = ClusterResult(
        components=[
            ComponentCluster(id="g0", container_id="c0", files=["b/other/y.py"]),
            ComponentCluster(id="g1", container_id="c0", files=["z/rbac/new.py"]),
        ],
        containers=[ContainerCluster(id="c0", component_ids=["g0", "g1"])],
    )

    delta = _diff_manifest(fresh, old_manifest)

    created = delta["components"]["created"]
    assert [(e["id"], e["name"]) for e in created] == [("rbac", "Rbac")]
    assert delta["components"]["deleted"] == ["rbac"]
