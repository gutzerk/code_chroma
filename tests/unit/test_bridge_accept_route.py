"""TestClient coverage for POST /repos/{repo_id}/diff/{node_id}/accept on bridge/routes/diffs.py."""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    )
    return result.stdout


@pytest.fixture
def client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)

    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo


def _node_id_for(body: list[dict], suffix: str) -> str:
    matches = [d["node_id"] for d in body if d["node_id"].endswith(suffix)]
    assert len(matches) == 1, f"expected exactly one match for {suffix!r}, got {matches}"
    return matches[0]


def test_accept_commits_only_the_targeted_function(client):
    test_client, repo = client
    invoice_path = repo / "billing" / "models" / "invoice.py"
    invoice_path.write_text(
        invoice_path.read_text()
        .replace('return sum(line["amount"] for line in lines)', "return 0.0")
        .replace('return f"INV-{number:06d}"', 'return "PATCHED"')
    )

    diff_body = test_client.get("/repos/default/diff").json()
    total_node_id = _node_id_for(diff_body, "::function::Invoice.total")

    response = test_client.post(f"/repos/default/diff/{total_node_id}/accept")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "committed"
    assert payload["file_path"] == "billing/models/invoice.py"

    committed_text = _git(repo, "show", "HEAD:billing/models/invoice.py")
    assert "return 0.0" in committed_text
    assert "PATCHED" not in committed_text

    remaining = test_client.get("/repos/default/diff").json()
    remaining_ids = [d["node_id"] for d in remaining]
    assert total_node_id not in remaining_ids
    assert any(node_id.endswith("::function::format_invoice_id") for node_id in remaining_ids)

    log = _git(repo, "log", "--oneline")
    assert len(log.strip().splitlines()) == 2


def test_accept_commits_a_whole_new_file(client):
    test_client, repo = client
    new_file = repo / "billing" / "refunds.py"
    new_file.write_text('class Refund:\n    """A refund."""\n    reason = "duplicate"\n')

    diff_body = test_client.get("/repos/default/diff").json()
    component_node_id = _node_id_for(diff_body, "component::billing/refunds.py")
    assert component_node_id == "component::billing/refunds.py"

    response = test_client.post(f"/repos/default/diff/{component_node_id}/accept")

    assert response.status_code == 200
    tracked = _git(repo, "ls-files", "--", "billing/refunds.py")
    assert "billing/refunds.py" in tracked

    remaining = test_client.get("/repos/default/diff").json()
    assert component_node_id not in [d["node_id"] for d in remaining]


def test_accept_commits_a_whole_file_deletion(client):
    test_client, repo = client
    (repo / "billing" / "service.py").unlink()

    diff_body = test_client.get("/repos/default/diff").json()
    deleted_node_id = _node_id_for(diff_body, "::function::BillingService.create_invoice")
    assert next(d for d in diff_body if d["node_id"] == deleted_node_id)["status"] == "deleted"

    response = test_client.post(f"/repos/default/diff/{deleted_node_id}/accept")

    assert response.status_code == 200
    tracked = _git(repo, "ls-files", "--", "billing/service.py")
    assert tracked == ""

    remaining = test_client.get("/repos/default/diff").json()
    assert all("billing/service.py" not in d["node_id"] for d in remaining)


def test_accept_leaves_git_status_clean_for_the_committed_file(client):
    test_client, repo = client
    invoice_path = repo / "billing" / "models" / "invoice.py"
    invoice_path.write_text(
        invoice_path.read_text().replace(
            'return sum(line["amount"] for line in lines)', "return 0.0"
        )
    )
    diff_body = test_client.get("/repos/default/diff").json()
    total_node_id = _node_id_for(diff_body, "::function::Invoice.total")

    response = test_client.post(f"/repos/default/diff/{total_node_id}/accept")

    assert response.status_code == 200
    status = _git(repo, "status", "--porcelain")
    assert "billing/models/invoice.py" not in status
    assert _git(repo, "diff", "HEAD", "--", "billing/models/invoice.py") == ""


def test_accept_commits_a_class_level_diff_without_duplicating_its_body(client):
    test_client, repo = client
    invoice_path = repo / "billing" / "models" / "invoice.py"
    invoice_path.write_text(
        invoice_path.read_text().replace(
            '"""A single billing invoice."""\n',
            '"""A single billing invoice."""\n\n    currency = "USD"\n',
        )
    )
    diff_body = test_client.get("/repos/default/diff").json()
    class_node_id = _node_id_for(diff_body, "class::Invoice")

    response = test_client.post(f"/repos/default/diff/{class_node_id}/accept")

    assert response.status_code == 200
    committed_text = _git(repo, "show", "HEAD:billing/models/invoice.py")
    assert 'currency = "USD"' in committed_text
    assert committed_text.count('"""A single billing invoice."""') == 1
    assert "billing/models/invoice.py" not in _git(repo, "status", "--porcelain")


def test_accept_returns_404_for_a_node_with_no_pending_change(client):
    test_client, _repo = client

    response = test_client.post(
        "/repos/default/diff/shared/text_utils.py::function::slugify/accept"
    )

    assert response.status_code == 404
