using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>Deterministic C1 (system-context) bootstrap: a curated table, no model call, ever; mirrors context/c1_template.py.</summary>
public static class C1Template
{
    public static readonly IReadOnlyDictionary<string, (string Name, string? Icon)> KnownExternalSystems = new Dictionary<string, (string Name, string? Icon)>
    {
        ["psycopg2"] = ("PostgreSQL", "postgresql"),
        ["psycopg2-binary"] = ("PostgreSQL", "postgresql"),
        ["psycopg"] = ("PostgreSQL", "postgresql"),
        ["asyncpg"] = ("PostgreSQL", "postgresql"),
        ["pg"] = ("PostgreSQL", "postgresql"),
        ["redis"] = ("Redis", "redis"),
        ["ioredis"] = ("Redis", "redis"),
        ["stripe"] = ("Stripe", "stripe"),
        ["pymongo"] = ("MongoDB", "mongodb"),
        ["mongodb"] = ("MongoDB", "mongodb"),
        ["mongoose"] = ("MongoDB", "mongodb"),
        ["mysqlclient"] = ("MySQL", "mysql"),
        ["pymysql"] = ("MySQL", "mysql"),
        ["mysql2"] = ("MySQL", "mysql"),
        ["mariadb"] = ("MariaDB", "mariadb"),
        ["sqlite3"] = ("SQLite", "sqlite"),
        ["aiosqlite"] = ("SQLite", "sqlite"),
        ["pika"] = ("RabbitMQ", "rabbitmq"),
        ["amqplib"] = ("RabbitMQ", "rabbitmq"),
        ["anthropic"] = ("Anthropic", "anthropic"),
        ["auth0"] = ("Auth0", "auth0"),
        ["auth0-python"] = ("Auth0", "auth0"),
        ["elasticsearch"] = ("Elasticsearch", "elasticsearch"),
        ["docker"] = ("Docker", "docker"),
        ["kubernetes"] = ("Kubernetes", "kubernetes"),
        ["boto3"] = ("AWS", null),
        ["aws-sdk"] = ("AWS", null),
        ["botocore"] = ("AWS", null),
        ["github.com/lib/pq"] = ("PostgreSQL", "postgresql"),
        ["github.com/jackc/pgx"] = ("PostgreSQL", "postgresql"),
        ["github.com/redis/go-redis"] = ("Redis", "redis"),
        ["github.com/go-redis/redis"] = ("Redis", "redis"),
        ["go.mongodb.org/mongo-driver"] = ("MongoDB", "mongodb"),
        ["github.com/go-sql-driver/mysql"] = ("MySQL", "mysql"),
        ["github.com/mattn/go-sqlite3"] = ("SQLite", "sqlite"),
        ["github.com/rabbitmq/amqp091-go"] = ("RabbitMQ", "rabbitmq"),
        ["github.com/streadway/amqp"] = ("RabbitMQ", "rabbitmq"),
        ["github.com/aws/aws-sdk-go"] = ("AWS", null),
        ["github.com/aws/aws-sdk-go-v2"] = ("AWS", null),
        ["github.com/elastic/go-elasticsearch"] = ("Elasticsearch", "elasticsearch"),
        ["github.com/docker/docker"] = ("Docker", "docker"),
        ["k8s.io/client-go"] = ("Kubernetes", "kubernetes"),
    };

    /// <summary>Builds a system + detected-actor C1 diagram straight from the context digest; marked `draft` until a skill rewrites it.</summary>
    public static JsonObject Generate(JsonObject digest)
    {
        var repoName = Json.Str(digest["repo_name"]);
        var name = string.IsNullOrEmpty(repoName) ? "system" : repoName;
        var nodes = new JsonArray(new JsonObject
        {
            ["id"] = SystemContext.SystemId,
            ["kind"] = "system",
            ["name"] = name,
            ["description"] = $"The {name} codebase.",
        });
        var relations = new JsonArray();
        var candidates = SystemContext.Detect(digest);
        foreach (var candidate in candidates)
        {
            var actor = new JsonObject
            {
                ["id"] = candidate.Id,
                ["kind"] = candidate.Kind,
                ["name"] = candidate.Name,
                ["description"] = candidate.Evidence,
            };
            if (!string.IsNullOrEmpty(candidate.Icon)) actor["icon"] = candidate.Icon;
            nodes.Add(actor);
            relations.Add(candidate.Kind == "person"
                ? new JsonObject { ["from"] = candidate.Id, ["to"] = SystemContext.SystemId, ["label"] = "Uses" }
                : new JsonObject { ["from"] = SystemContext.SystemId, ["to"] = candidate.Id, ["label"] = "Uses" });
        }
        return new JsonObject
        {
            ["type"] = "system-context",
            ["style"] = "boxes-arrows",
            ["nodes"] = nodes,
            ["relations"] = relations,
            ["draft"] = true,
            ["fingerprint"] = SystemContext.Fingerprint(candidates),
        };
    }
}
