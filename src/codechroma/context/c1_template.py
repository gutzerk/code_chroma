"""Deterministic C1 (system-context) bootstrap: a curated table, no model call, ever.

Called at most once per repo -- only when `.codechroma/c1.json` doesn't exist yet. Unlike the
AI-only bootstrap this replaces, it needs no `ANTHROPIC_API_KEY`: it matches the digest's own
dependency signals against a fixed name -> {name, icon} table and emits system + actor nodes.

The output carries `"draft": true` -- a marker that this is the unreviewed skeleton, not a diagram
a human or the interactive codechroma-draw-diagram skill has actually looked at. The skill's own
schema (`type-c1.md`) has no `draft` key, so the marker disappears the moment it rewrites the file
for real; nothing has to remember to clear it.
"""

from __future__ import annotations

__all__ = ["generate_c1_template", "KNOWN_EXTERNAL_SYSTEMS"]

KNOWN_EXTERNAL_SYSTEMS: dict[str, dict] = {
    "psycopg2": {"name": "PostgreSQL", "icon": "postgresql"},
    "psycopg2-binary": {"name": "PostgreSQL", "icon": "postgresql"},
    "psycopg": {"name": "PostgreSQL", "icon": "postgresql"},
    "asyncpg": {"name": "PostgreSQL", "icon": "postgresql"},
    "pg": {"name": "PostgreSQL", "icon": "postgresql"},
    "redis": {"name": "Redis", "icon": "redis"},
    "ioredis": {"name": "Redis", "icon": "redis"},
    "stripe": {"name": "Stripe", "icon": "stripe"},
    "pymongo": {"name": "MongoDB", "icon": "mongodb"},
    "mongodb": {"name": "MongoDB", "icon": "mongodb"},
    "mongoose": {"name": "MongoDB", "icon": "mongodb"},
    "mysqlclient": {"name": "MySQL", "icon": "mysql"},
    "pymysql": {"name": "MySQL", "icon": "mysql"},
    "mysql2": {"name": "MySQL", "icon": "mysql"},
    "mariadb": {"name": "MariaDB", "icon": "mariadb"},
    "sqlite3": {"name": "SQLite", "icon": "sqlite"},
    "aiosqlite": {"name": "SQLite", "icon": "sqlite"},
    "pika": {"name": "RabbitMQ", "icon": "rabbitmq"},
    "amqplib": {"name": "RabbitMQ", "icon": "rabbitmq"},
    "anthropic": {"name": "Anthropic", "icon": "anthropic"},
    "auth0": {"name": "Auth0", "icon": "auth0"},
    "auth0-python": {"name": "Auth0", "icon": "auth0"},
    "elasticsearch": {"name": "Elasticsearch", "icon": "elasticsearch"},
    "docker": {"name": "Docker", "icon": "docker"},
    "kubernetes": {"name": "Kubernetes", "icon": "kubernetes"},
    "boto3": {"name": "AWS", "icon": None},
    "aws-sdk": {"name": "AWS", "icon": None},
    "botocore": {"name": "AWS", "icon": None},
    # Go module-path equivalents (github.com/... etc.) -- go.mod deps, see context/digest.py.
    "github.com/lib/pq": {"name": "PostgreSQL", "icon": "postgresql"},
    "github.com/jackc/pgx": {"name": "PostgreSQL", "icon": "postgresql"},
    "github.com/redis/go-redis": {"name": "Redis", "icon": "redis"},
    "github.com/go-redis/redis": {"name": "Redis", "icon": "redis"},
    "go.mongodb.org/mongo-driver": {"name": "MongoDB", "icon": "mongodb"},
    "github.com/go-sql-driver/mysql": {"name": "MySQL", "icon": "mysql"},
    "github.com/mattn/go-sqlite3": {"name": "SQLite", "icon": "sqlite"},
    "github.com/rabbitmq/amqp091-go": {"name": "RabbitMQ", "icon": "rabbitmq"},
    "github.com/streadway/amqp": {"name": "RabbitMQ", "icon": "rabbitmq"},
    "github.com/aws/aws-sdk-go": {"name": "AWS", "icon": None},
    "github.com/aws/aws-sdk-go-v2": {"name": "AWS", "icon": None},
    "github.com/elastic/go-elasticsearch": {"name": "Elasticsearch", "icon": "elasticsearch"},
    "github.com/docker/docker": {"name": "Docker", "icon": "docker"},
    "k8s.io/client-go": {"name": "Kubernetes", "icon": "kubernetes"},
}


def _system_node(digest: dict) -> dict:
    repo_name = digest.get("repo_name")
    name = repo_name if isinstance(repo_name, str) and repo_name else "system"
    return {
        "id": "system",
        "kind": "system",
        "name": name,
        "description": f"The {name} codebase.",
    }


def _candidates(digest: dict) -> list[str]:
    declared = digest.get("declared_dependencies")
    declared_list = declared if isinstance(declared, list) else []
    roots = digest.get("external_import_roots")
    roots_list = roots if isinstance(roots, list) else []
    candidates: list[str] = [name for name in declared_list if isinstance(name, str)]
    for entry in roots_list:
        if isinstance(entry, dict) and isinstance(entry.get("root"), str):
            candidates.append(entry["root"])
    return candidates


def generate_c1_template(digest: dict) -> dict:
    """Builds a system + known-actor C1 diagram straight from the digest -- no model call."""
    nodes: list[dict] = [_system_node(digest)]
    relations: list[dict] = []
    seen_candidates: set[str] = set()
    seen_names: set[str] = set()
    for candidate in _candidates(digest):
        entry = KNOWN_EXTERNAL_SYSTEMS.get(candidate)
        if entry is None or candidate in seen_candidates:
            continue
        seen_candidates.add(candidate)
        # Two keys can share a display name (psycopg2/asyncpg -> PostgreSQL); one box per name.
        if entry["name"] in seen_names:
            continue
        seen_names.add(entry["name"])
        actor_id = candidate
        actor: dict = {
            "id": actor_id,
            "kind": "external_system",
            "name": entry["name"],
            "description": f"Detected via the '{candidate}' dependency.",
        }
        if entry.get("icon"):
            actor["icon"] = entry["icon"]
        nodes.append(actor)
        relations.append({"from": "system", "to": actor_id, "label": "Uses"})
    return {
        "type": "c1", "style": "boxes-arrows", "nodes": nodes, "relations": relations,
        "draft": True,
    }
