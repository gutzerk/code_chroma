"""TestClient coverage for GET /repos/{repo_id}/diff on bridge/routes/diffs.py."""

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


@pytest.fixture
def client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)

    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo


def test_diff_route_is_empty_with_no_uncommitted_changes(client):
    test_client, _repo = client

    response = test_client.get("/repos/default/diff")

    assert response.status_code == 200
    assert response.json() == []


def test_diff_route_reports_a_modified_function(client):
    test_client, repo = client
    slugify_path = repo / "shared" / "text_utils.py"
    slugify_path.write_text(
        slugify_path.read_text().replace(
            'return text.strip().lower().replace(" ", "-")', 'return "patched"'
        )
    )

    response = test_client.get("/repos/default/diff")

    body = response.json()
    matching = [d for d in body if d["node_id"].endswith("::function::slugify")]
    assert response.status_code == 200
    assert len(matching) == 1
    assert "patched" in matching[0]["proposed_source"]


def test_diff_route_reports_an_added_file_container(client):
    test_client, repo = client
    new_file = repo / "billing" / "refunds.py"
    new_file.write_text('class Refund:\n    """A refund."""\n    reason = "duplicate"\n')

    response = test_client.get("/repos/default/diff")

    body = response.json()
    file_entries = [d for d in body if d["node_id"] == "component::billing/refunds.py"]
    assert response.status_code == 200
    assert len(file_entries) == 1
    assert file_entries[0]["status"] == "added"
    assert file_entries[0]["level"] == "file"


def test_diff_route_reports_an_added_class_with_no_functions(client):
    test_client, repo = client
    new_file = repo / "billing" / "refunds.py"
    new_file.write_text('class Refund:\n    """A refund."""\n    reason = "duplicate"\n')

    response = test_client.get("/repos/default/diff")

    body = response.json()
    class_entries = [
        d
        for d in body
        if d["level"] == "class" and d["status"] == "added" and d["name"] == "Refund"
    ]
    assert response.status_code == 200
    assert len(class_entries) == 1


def test_diff_route_reports_a_modified_class_without_a_function_change(client):
    test_client, repo = client
    invoice_path = repo / "billing" / "models" / "invoice.py"
    invoice_path.write_text(
        invoice_path.read_text().replace(
            '"""A single billing invoice."""\n',
            '"""A single billing invoice."""\n\n    currency = "USD"\n',
        )
    )

    response = test_client.get("/repos/default/diff")

    body = response.json()
    class_entries = [
        d
        for d in body
        if d["level"] == "class" and d["status"] == "modified" and d["name"] == "Invoice"
    ]
    assert response.status_code == 200
    assert len(class_entries) == 1
    assert 'currency = "USD"' in class_entries[0]["proposed_source"]


def test_diff_route_omits_the_class_entry_when_a_method_changed(client):
    test_client, repo = client
    invoice_path = repo / "billing" / "models" / "invoice.py"
    invoice_path.write_text(
        invoice_path.read_text().replace(
            'return sum(line["amount"] for line in lines)', "return 0.0"
        )
    )

    response = test_client.get("/repos/default/diff")

    body = response.json()
    function_entries = [d for d in body if d["node_id"].endswith("::function::Invoice.total")]
    modified_class_entries = [
        d
        for d in body
        if d["level"] == "class" and d["status"] == "modified" and d["name"] == "Invoice"
    ]
    assert response.status_code == 200
    assert len(function_entries) == 1
    assert modified_class_entries == []
