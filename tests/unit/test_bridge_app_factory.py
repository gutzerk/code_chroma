"""Two apps over two repositories coexist in one process -- what module globals made impossible.

Every collaborator that used to be a `server.py` global (the workspace registry, the agent and PR
registries, the WebSocket fan-out) now belongs to one app, so nothing one app does can be observed
by the other.
"""

from fastapi.testclient import TestClient


def test_two_apps_serve_their_own_repositories(make_repo, make_bridge):
    first = make_repo(name="first")
    second = make_repo(
        lambda repo: (repo / "only_here.py").write_text("x = 1\n", encoding="utf-8"), name="second"
    )

    one = TestClient(make_bridge(first).app)
    two = TestClient(make_bridge(second).app)

    names_one = {c["name"] for c in one.get("/repos/main/nodes/root/children").json()}
    names_two = {c["name"] for c in two.get("/repos/main/nodes/root/children").json()}
    assert "only_here.py" in names_two
    assert "only_here.py" not in names_one


def test_each_app_reports_its_own_repo_root(make_repo, make_bridge):
    first = make_repo(name="first")
    second = make_repo(name="second")

    one = make_bridge(first)
    two = make_bridge(second)

    assert one.services.repo_root == first
    assert two.services.repo_root == second
    assert one.registry.main is not two.registry.main


def test_an_agent_registered_in_one_app_is_invisible_to_the_other(make_repo, make_bridge):
    first = make_repo(name="first")
    second = make_repo(name="second")
    one = make_bridge(first)
    two = make_bridge(second)

    one.registry.register("refund-flow", first / "elsewhere")

    assert one.registry.is_registered("refund-flow")
    assert not two.registry.is_registered("refund-flow")


def test_each_app_has_its_own_connection_manager(make_repo, make_bridge):
    one = make_bridge(make_repo(name="first"))
    two = make_bridge(make_repo(name="second"))

    assert one.connections is not two.connections
    assert one.agent_sessions is not two.agent_sessions


def test_create_app_installs_skills_for_headless_agents(make_repo, make_bridge):
    repo = make_repo(name="first")

    make_bridge(repo)

    installed = {p.name for p in (repo / ".claude" / "skills").iterdir()}
    assert "codechroma-draw-diagram" in installed
    assert (repo / ".claude" / "skills" / "codechroma-draw-diagram" / "SKILL.md").exists()
