import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.routes import issues


@pytest.fixture(autouse=True)
def _fresh_ready_cache(monkeypatch):
    monkeypatch.setattr(issues, "_ready_cache", None)


def _client(make_bridge, make_repo):
    return TestClient(make_bridge(make_repo()).app)


def test_status_reports_cannot_post_without_gh(make_bridge, make_repo, monkeypatch):
    monkeypatch.setattr(issues, "_gh_ready", lambda: False)
    client = _client(make_bridge, make_repo)

    body = client.get("/issues/status").json()

    assert body == {"repo": issues.ISSUE_REPO, "can_post": False}


def test_create_issue_returns_url_from_gh(make_bridge, make_repo, monkeypatch):
    calls = []
    monkeypatch.setattr(issues, "_gh_ready", lambda: True)
    monkeypatch.setattr(
        issues,
        "run_gh",
        lambda cwd, *args: calls.append(args) or "https://github.com/x/y/issues/7\n",
    )
    client = _client(make_bridge, make_repo)

    response = client.post("/issues", json={"title": "T", "body": "B", "label": "bug"})

    assert response.json() == {"url": "https://github.com/x/y/issues/7"}
    assert "--title" in calls[0] and "T" in calls[0]


def test_create_issue_conflicts_when_gh_not_ready(make_bridge, make_repo, monkeypatch):
    monkeypatch.setattr(issues, "_gh_ready", lambda: False)
    client = _client(make_bridge, make_repo)

    response = client.post("/issues", json={"title": "T"})

    assert response.status_code == 409


def test_create_issue_rejects_blank_title_and_unknown_label(make_bridge, make_repo):
    client = _client(make_bridge, make_repo)

    blank = client.post("/issues", json={"title": " "})
    bad_label = client.post("/issues", json={"title": "T", "label": "nope"})

    assert (blank.status_code, bad_label.status_code) == (400, 400)


def test_gh_readiness_is_probed_once_within_the_cache_window(monkeypatch):
    probes = []
    monkeypatch.setattr(issues, "cli_available", lambda name: True)
    monkeypatch.setattr(issues, "run_gh", lambda cwd, *args, **kw: probes.append(args) or "ok")

    first, second = issues._gh_ready(), issues._gh_ready()

    assert (first, second, len(probes)) == (True, True, 1)
