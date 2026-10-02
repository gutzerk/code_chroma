"""Unit coverage for generate_c1_template: a pure, credential-free C1 bootstrap."""

from codechroma.context.c1_template import generate_c1_template


def test_empty_digest_returns_system_only_diagram():
    result = generate_c1_template({})

    assert result["nodes"] == [
        {"id": "system", "kind": "system", "name": "system", "description": "The system codebase."}
    ]
    assert result["relations"] == []


def test_known_dependency_becomes_actor_with_icon():
    digest = {"repo_name": "sample", "declared_dependencies": ["stripe"]}

    result = generate_c1_template(digest)

    actors = [node for node in result["nodes"] if node["id"] != "system"]
    assert actors == [
        {
            "id": "stripe",
            "kind": "external_system",
            "name": "Stripe",
            "description": "Detected via the 'stripe' dependency.",
            "icon": "stripe",
        }
    ]


def test_every_actor_has_a_system_relation():
    digest = {
        "repo_name": "sample",
        "declared_dependencies": ["stripe", "redis", "psycopg2"],
    }

    result = generate_c1_template(digest)

    actor_ids = {node["id"] for node in result["nodes"] if node["id"] != "system"}
    relation_targets = {r["to"] for r in result["relations"] if r["from"] == "system"}
    assert actor_ids == relation_targets
    assert len(result["relations"]) == len(actor_ids)


def test_same_dependency_via_both_signals_is_not_duplicated():
    digest = {
        "repo_name": "sample",
        "declared_dependencies": ["stripe"],
        "external_import_roots": [{"root": "stripe", "count": 5}],
    }

    result = generate_c1_template(digest)

    actors = [node for node in result["nodes"] if node["id"] != "system"]
    assert len(actors) == 1


def test_known_go_module_path_becomes_actor_with_icon():
    digest = {"repo_name": "sample", "declared_dependencies": ["github.com/lib/pq"]}

    result = generate_c1_template(digest)

    actors = [node for node in result["nodes"] if node["id"] != "system"]
    assert actors == [
        {
            "id": "github.com/lib/pq",
            "kind": "external_system",
            "name": "PostgreSQL",
            "description": "Detected via the 'github.com/lib/pq' dependency.",
            "icon": "postgresql",
        }
    ]


def test_two_keys_sharing_a_display_name_produce_only_one_actor():
    digest = {
        "repo_name": "sample",
        "declared_dependencies": ["psycopg2", "asyncpg"],
    }

    result = generate_c1_template(digest)

    actors = [node for node in result["nodes"] if node["id"] != "system"]
    assert len(actors) == 1
    assert actors[0]["id"] == "psycopg2"


def test_output_is_marked_as_a_draft():
    result = generate_c1_template({})

    assert result["draft"] is True


def test_unknown_dependency_is_skipped():
    digest = {
        "repo_name": "sample",
        "declared_dependencies": ["stripe", "some-unknown-package"],
    }

    result = generate_c1_template(digest)

    actor_ids = {node["id"] for node in result["nodes"] if node["id"] != "system"}
    assert actor_ids == {"stripe"}
