"""TestClient coverage for the /prs routes, with a stub `gh` and a local repository as `origin`.

🔴 No network and no GitHub account: `gh` is a shell script on PATH, and `origin` is a bare repo on
disk carrying a real `refs/pull/<n>/head` exactly as GitHub serves one.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.prs import github as pr_github
from codechroma.bridge.routes.prs import PR_REASON_GH_MISSING
from codechroma.bridge.skill_agent import SkillAgent

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"

PR_METADATA = {
    "number": 7,
    "title": "Add refunds",
    "url": "https://github.com/acme/app/pull/7",
    "state": "OPEN",
    "author": {"login": "octocat"},
    "headRefName": "feature/refunds",
    "headRefOid": "unused-the-fetch-decides",
    "baseRefName": "main",
    "isCrossRepository": True,
    "headRepositoryOwner": {"login": "octocat"},
    "additions": 2,
    "deletions": 0,
    "changedFiles": 1,
}


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout


def _stub_gh(bin_dir: Path, metadata: dict | None, open_prs: list[dict] | None = None) -> None:
    """A fake `gh` answering `auth status`, `pr view` and `pr list`. A None arg fails that verb."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    answers = {
        "auth status": "",
        "repo view": '{"nameWithOwner":"acme/app"}',
        "pr view": None if metadata is None else json.dumps(metadata),
        "pr list": None if open_prs is None else json.dumps(open_prs),
    }
    stub = bin_dir / "gh_stub.py"
    stub.write_text(
        "import json, sys\n"
        f"answers = json.loads({json.dumps(json.dumps(answers))})\n"
        'answer = answers.get(" ".join(sys.argv[1:3]))\n'
        "if answer is None:\n    sys.exit(1)\n"
        "print(answer)\n",
        encoding="utf-8",
    )
    if os.name == "nt":
        (bin_dir / "gh.cmd").write_text(f'@"{sys.executable}" "{stub}" %*\n', encoding="utf-8")
    else:
        script = bin_dir / "gh"
        script.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{stub}" "$@"\n', encoding="utf-8")
        script.chmod(0o755)


def _mock_gh_resolution(monkeypatch, open_prs: list[dict] | None) -> None:
    """Make the `/prs/github` endpoint deterministic without requiring a shell on PATH."""
    monkeypatch.setattr(pr_github, "has_gh", lambda: True)

    def run_gh(_root: Path, *args: str) -> str | None:
        if args == ("auth", "status"):
            return ""
        if args == ("repo", "view", "--json", "nameWithOwner"):
            return json.dumps({"nameWithOwner": "acme/app"})
        if args[:2] == ("pr", "list"):
            return json.dumps(open_prs) if open_prs is not None else None
        return None

    monkeypatch.setattr(pr_github, "run_gh", run_gh)


@pytest.fixture
def origin(tmp_path):
    """A bare 'GitHub' whose refs/pull/7/head is one commit ahead of main."""
    seed = tmp_path / "seed"
    shutil.copytree(FIXTURE_REPO, seed)
    _git(seed, "init", "-b", "main")
    _git(seed, "config", "user.email", "test@example.com")
    _git(seed, "config", "user.name", "Test")
    _git(seed, "add", "-A")
    _git(seed, "commit", "-m", "initial")
    _git(seed, "checkout", "-b", "feature/refunds")
    (seed / "shared" / "refund.py").write_text(
        "def issue_refund():\n    return 1\n", encoding="utf-8"
    )
    _git(seed, "add", "-A")
    _git(seed, "commit", "-m", "add refunds")
    bare = tmp_path / "origin.git"
    _git(tmp_path, "init", "--bare", str(bare))
    _git(seed, "remote", "add", "origin", str(bare))
    _git(seed, "push", "origin", "main")
    _git(seed, "push", "origin", "feature/refunds:refs/pull/7/head")
    return bare


@pytest.fixture
def client(tmp_path, origin, monkeypatch, make_bridge, use_test_runtime):
    bin_dir = tmp_path / "bin"
    _stub_gh(bin_dir, PR_METADATA)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    use_test_runtime()
    repo = tmp_path / "repo"
    _git(tmp_path, "clone", str(origin), str(repo))
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    # The bridge fetches from this local path; the fake gh resolves the checkout as acme/app.
    _git(repo, "remote", "set-url", "--push", "origin", str(origin))
    _git(repo, "config", "remote.origin.url", "https://github.com/acme/app.git")
    _git(repo, "config", "remote.origin.pushurl", str(origin))
    _git(repo, "config", f"url.{origin}.insteadOf", "https://github.com/acme/app.git")
    monkeypatch.setenv("codechroma_WORKSPACES_DIR", str(tmp_path / "worktrees"))

    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo, bridge, bin_dir


def _open_pr(test_client: TestClient, ref: str = "https://github.com/acme/app/pull/7"):
    return test_client.post("/prs", json={"ref": ref})


def test_preflight_is_ready_with_gh_present_and_a_github_origin(client):
    test_client, _repo, _server, _bin = client

    body = test_client.get("/prs/preflight").json()

    assert body["ready"]
    assert body["origin"] == {"owner": "acme", "repo": "app"}
    assert body["count"] == 0


def test_preflight_reports_a_missing_gh_as_its_button_label(client, tmp_path, monkeypatch):
    test_client, _repo, bridge, _bin = client
    monkeypatch.setattr(pr_github, "has_gh", lambda: False)

    body = test_client.get("/prs/preflight").json()

    assert not body["ready"]
    assert body["reason"] == PR_REASON_GH_MISSING
    assert body["text"] == "GitHub CLI required"


def test_junk_is_rejected_before_anything_is_spawned(client):
    test_client, _repo, _server, _bin = client

    response = _open_pr(test_client, "not a pull request")

    assert response.status_code == 400
    assert "number like #123" in response.json()["detail"]


def test_another_repositorys_pull_request_is_rejected(client):
    test_client, _repo, _server, _bin = client

    response = _open_pr(test_client, "https://github.com/other/thing/pull/7")

    assert response.status_code == 400
    assert response.json()["detail"] == "That pull request is in another repository"


def test_a_pull_request_gh_cannot_find_is_a_404(client, tmp_path):
    test_client, _repo, _server, bin_dir = client
    _stub_gh(bin_dir, None)

    response = _open_pr(test_client, "999")

    assert response.status_code == 404


def test_opening_a_pull_request_fetches_it_into_a_registered_workspace(client):
    test_client, _repo, bridge, _bin = client

    response = _open_pr(test_client)

    body = response.json()
    assert response.status_code == 200, body
    assert body["id"] == "pr-7"
    assert body["is_fork"]
    assert body["base_ref"] == "main"
    assert bridge.registry.is_registered("pr-7")
    assert bridge.registry.is_read_only("pr-7")
    assert Path(body["worktree"], "shared", "refund.py").exists()


def test_opening_the_same_pull_request_twice_links_to_the_first(client):
    test_client, _repo, _server, _bin = client
    first = _open_pr(test_client).json()

    second = _open_pr(test_client, "7")

    assert second.status_code == 200
    assert second.json()["worktree"] == first["worktree"]
    assert len(test_client.get("/prs").json()["prs"]) == 1


def test_the_pull_requests_own_code_is_what_the_canvas_reads(client):
    test_client, _repo, _server, _bin = client
    _open_pr(test_client)

    pr_children = test_client.get("/repos/pr-7/nodes/dir::shared/children").json()
    main_children = test_client.get("/repos/main/nodes/dir::shared/children").json()

    assert any(child["name"] == "refund.py" for child in pr_children)
    assert not any(child["name"] == "refund.py" for child in main_children)


def test_the_pull_requests_change_cards_describe_its_own_diff(client):
    test_client, _repo, _server, _bin = client
    _open_pr(test_client)

    body = test_client.get("/repos/pr-7/change-cards").json()

    assert body["base_resolved"]
    assert any(card["file"] == "shared/refund.py" for card in body["cards"])
    assert test_client.get("/repos/main/change-cards").json()["cards"] == []


def test_a_pull_request_workspace_can_be_activated(client):
    test_client, _repo, bridge, _bin = client
    _open_pr(test_client)

    response = test_client.post("/workspaces/pr-7/activate")

    assert response.status_code == 200
    assert bridge.agent_manager.active_workspace == "pr-7"


def test_the_terminal_roots_itself_in_the_pull_requests_own_worktree(client):
    test_client, repo, bridge, _bin = client
    body = _open_pr(test_client).json()

    assert bridge.workspace_cwd("pr-7") == body["worktree"]
    assert bridge.workspace_cwd("pr-7") != str(repo)


def test_a_pull_request_workspace_refuses_to_accept_a_diff(client):
    test_client, _repo, _server, _bin = client
    body = _open_pr(test_client).json()
    before = _git(Path(body["worktree"]), "rev-parse", "HEAD")

    response = test_client.post("/repos/pr-7/diff/shared%2Frefund.py::function::x/accept")

    assert response.status_code == 409
    assert _git(Path(body["worktree"]), "rev-parse", "HEAD") == before


def test_a_pull_request_workspace_may_spawn_a_claude_run(client, monkeypatch):
    """A read-only PR still runs diagram skills (generate is allowed there — it only writes
    .codechroma/ artifacts, and the skill needs to run for impact to author its diagram). The
    read-only guard applies to git-mutating routes (diffs), not generation."""
    test_client, _repo, _server, _bin = client
    _open_pr(test_client)

    started: list[str] = []

    async def record_start(*_args, **_kwargs):
        started.append("start")
        return {"state": "idle", "error": None}

    monkeypatch.setattr(SkillAgent, "start", record_start)

    assert test_client.post("/repos/pr-7/c1/generate").status_code == 200
    assert started == ["start"]


def test_refreshing_an_unmoved_pull_request_reports_no_change(client):
    test_client, _repo, _server, _bin = client
    _open_pr(test_client)

    body = test_client.post("/prs/7/refresh").json()

    assert body["updated"] is False
    assert body["head_sha"] == body["previous_head_sha"]


def test_refreshing_an_unknown_pull_request_is_a_404(client):
    test_client, _repo, _server, _bin = client

    assert test_client.post("/prs/999/refresh").status_code == 404


def test_refreshing_a_pull_request_pings_its_own_workspace_to_refetch(client, monkeypatch):
    test_client, _repo, bridge, _bin = client
    _open_pr(test_client)
    messages = []

    async def fake_broadcast(message):
        messages.append(message)

    monkeypatch.setattr(bridge.connections, "broadcast", fake_broadcast)

    test_client.post("/prs/7/refresh")

    assert {"type": "changed", "paths": [], "workspace": "pr-7"} in messages


def test_closing_a_pull_request_removes_its_worktree_refs_and_registration(client):
    test_client, repo, bridge, _bin = client
    body = _open_pr(test_client).json()

    response = test_client.delete("/prs/7")

    assert response.json() == {"status": "deleted", "id": "pr-7"}
    assert not Path(body["worktree"]).exists()
    assert not bridge.registry.is_registered("pr-7")
    assert _git(repo, "for-each-ref", "--format=%(refname)", "refs/codechroma").strip() == ""


def test_closing_the_active_pull_request_returns_the_canvas_to_main(client):
    test_client, _repo, bridge, _bin = client
    _open_pr(test_client)
    test_client.post("/workspaces/pr-7/activate")

    test_client.delete("/prs/7")

    assert bridge.agent_manager.active_workspace == "main"


def test_refreshing_a_pull_request_with_an_attached_agent_is_refused(client):
    test_client, _repo, bridge, _bin = client
    _open_pr(test_client)
    bridge.agent_manager.create("reviewer", attach_to="pr-7")

    response = test_client.post("/prs/7/refresh")

    assert response.status_code == 409


def test_closing_a_pull_request_with_an_attached_agent_is_refused(client):
    test_client, repo, bridge, _bin = client
    body = _open_pr(test_client).json()
    bridge.agent_manager.create("reviewer", attach_to="pr-7")

    response = test_client.delete("/prs/7")

    assert response.status_code == 409
    assert Path(body["worktree"]).exists()


def test_closing_an_unknown_pull_request_is_a_404(client):
    test_client, _repo, _server, _bin = client

    assert test_client.delete("/prs/999").status_code == 404


def test_the_cap_refuses_one_more_review(client, monkeypatch):
    test_client, _repo, bridge, _bin = client
    monkeypatch.setattr(bridge.pr_manager, "at_capacity", lambda: True)

    response = _open_pr(test_client)

    assert response.status_code == 409
    assert "limit of" in response.json()["detail"]


def test_the_list_route_reports_the_cap_and_the_active_workspace(client):
    test_client, _repo, _server, _bin = client
    _open_pr(test_client)

    body = test_client.get("/prs").json()

    assert body["max_prs"] == server_max_prs()
    assert body["active_workspace"] == "main"
    assert body["prs"][0]["id"] == "pr-7"


def test_github_prs_lists_open_prs_from_gh(client, monkeypatch):
    test_client, _repo, _server, _bin = client
    _mock_gh_resolution(
        monkeypatch,
        [
            {"number": 7, "title": "Add refunds", "headRefName": "feature/refunds",
             "author": {"login": "octocat"}},
            {"number": 9, "title": "Add coupons", "headRefName": "feature/coupons",
             "author": {"login": "jane"}},
        ],
    )

    body = test_client.get("/prs/github").json()

    assert body["prs"] == [
        {"number": 7, "title": "Add refunds", "head_ref": "feature/refunds", "author": "octocat"},
        {"number": 9, "title": "Add coupons", "head_ref": "feature/coupons", "author": "jane"},
    ]


def test_github_prs_ignores_the_import_cap(client, monkeypatch):
    test_client, _repo, bridge, _bin = client
    monkeypatch.setattr(bridge.pr_manager, "at_capacity", lambda: True)
    _mock_gh_resolution(monkeypatch, [])

    response = test_client.get("/prs/github")

    assert response.status_code == 200
    assert response.json()["prs"] == []


def test_github_prs_works_with_an_upstream_remote_instead_of_origin(client, monkeypatch):
    test_client, repo, _server, _bin = client
    _mock_gh_resolution(monkeypatch, [])
    _git(repo, "remote", "remove", "origin")
    _git(repo, "remote", "add", "upstream", "git@github.com:acme/app.git")

    response = test_client.get("/prs/github")

    assert response.status_code == 200
    assert response.json()["prs"] == []


def test_github_prs_works_with_a_custom_ssh_alias(client, monkeypatch):
    test_client, repo, _server, _bin = client
    _mock_gh_resolution(monkeypatch, [])
    _git(repo, "remote", "set-url", "origin", "git@gh-work:acme/app.git")

    response = test_client.get("/prs/github")

    assert response.status_code == 200
    assert response.json()["prs"] == []


def test_github_prs_reports_a_missing_gh_as_its_own_blocker(client, monkeypatch):
    test_client, _repo, _server, _bin = client
    monkeypatch.setattr(pr_github, "has_gh", lambda: False)

    response = test_client.get("/prs/github")

    assert response.status_code == 409
    assert response.json()["detail"] == "GitHub CLI required"


def test_github_prs_reports_authentication_failure_separately(client, monkeypatch):
    test_client, _repo, _server, _bin = client
    monkeypatch.setattr(pr_github, "has_gh", lambda: True)
    monkeypatch.setattr(pr_github, "is_authenticated", lambda _root: False)

    response = test_client.get("/prs/github")

    assert response.status_code == 409
    assert response.json()["detail"] == "Log in: gh auth login"


def test_github_prs_reports_repository_detection_failure_separately(client, monkeypatch):
    test_client, _repo, _server, _bin = client
    monkeypatch.setattr(pr_github, "has_gh", lambda: True)
    monkeypatch.setattr(pr_github, "is_authenticated", lambda _root: True)
    monkeypatch.setattr(pr_github, "is_github_repository", lambda _root: False)

    response = test_client.get("/prs/github")

    assert response.status_code == 409
    assert "gh repo view" in response.json()["detail"]


def test_github_prs_reports_a_gh_failure_as_a_502(client, monkeypatch):
    test_client, _repo, _server, _bin = client
    _mock_gh_resolution(monkeypatch, None)

    response = test_client.get("/prs/github")

    assert response.status_code == 502
    assert "gh pr list" in response.json()["detail"]


def server_max_prs() -> int:
    from codechroma.bridge.prs.manager import max_pr_workspaces

    return max_pr_workspaces()


def test_opening_a_pull_request_fetches_and_stores_its_comments(client, monkeypatch):
    test_client, _repo, bridge, _bin = client
    monkeypatch.setattr(
        pr_github,
        "fetch_review_comments",
        lambda _root, _number: [{"author": "jane", "body": "Why?", "path": "shared/refund.py"}],
    )
    monkeypatch.setattr(
        pr_github,
        "fetch_general_comments",
        lambda _root, _number: [
            {"author": "jane", "body": "LGTM", "created_at": "", "path": None, "line": None}
        ],
    )

    body = _open_pr(test_client).json()

    assert body["review_comments"][0]["body"] == "Why?"
    assert body["general_comments"][0]["body"] == "LGTM"


def test_the_pr_comments_helper_reads_the_records_comments(client, monkeypatch):
    test_client, _repo, bridge, _bin = client

    def review(_root, _n):
        return [{"body": "x"}]

    def general(_root, _n):
        return [{"body": "y"}]

    monkeypatch.setattr(pr_github, "fetch_review_comments", review)
    monkeypatch.setattr(pr_github, "fetch_general_comments", general)
    _open_pr(test_client)

    review, general = bridge.pr_comments("pr-7")

    assert (review, general) == ([{"body": "x"}], [{"body": "y"}])


def test_the_pr_comments_helper_is_empty_for_a_non_pr_workspace(client):
    _test_client, _repo, bridge, _bin = client

    assert bridge.pr_comments("main") == ([], [])


def test_the_pr_comments_helper_is_empty_for_an_unopened_pull_request(client):
    _test_client, _repo, bridge, _bin = client

    assert bridge.pr_comments("pr-999") == ([], [])


def test_opening_a_pr_copies_mains_authored_diagrams_onto_the_worktree(client, monkeypatch):
    test_client, repo, _bridge, _bin = client
    # Main has authored patterns + a custom diagram before the PR is opened.
    patterns_dir = repo / ".codechroma/diagrams/patterns"
    patterns_dir.mkdir(parents=True, exist_ok=True)
    (patterns_dir / "patterns.json").write_text('{"patterns": [1]}', encoding="utf-8")
    custom = repo / ".codechroma/diagrams/custom/data-flow"
    custom.mkdir(parents=True, exist_ok=True)
    (custom / "data-flow.json").write_text('{"nodes": []}', encoding="utf-8")

    _open_pr(test_client)

    from codechroma.bridge.prs import importer as pr_importer

    pr_root = pr_importer.worktree_path(repo, 7)
    assert (
        pr_root / ".codechroma/diagrams/patterns/patterns.json"
    ).read_text(encoding="utf-8") == '{"patterns": [1]}'
    assert (
        pr_root / ".codechroma/diagrams/custom/data-flow/data-flow.json"
    ).read_text(encoding="utf-8") == '{"nodes": []}'
    # Main is untouched.
    assert (repo / ".codechroma/diagrams/patterns/patterns.json").read_text(
        encoding="utf-8"
    ) == '{"patterns": [1]}'
