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

    /// <summary>Builds a system + known-actor C1 diagram straight from the context digest; marked `draft` until a skill rewrites it.</summary>
    public static JsonObject Generate(JsonObject digest)
    {
        var repoName = Json.Str(digest["repo_name"]);
        var name = string.IsNullOrEmpty(repoName) ? "system" : repoName;
        var nodes = new JsonArray(new JsonObject
        {
            ["id"] = "system",
            ["kind"] = "system",
            ["name"] = name,
            ["description"] = $"The {name} codebase.",
        });
        var relations = new JsonArray();
        var seenNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var candidate in Candidates(digest))
        {
            if (!KnownExternalSystems.TryGetValue(candidate, out var entry)) continue;
            // Two keys can share a display name (psycopg2/asyncpg -> PostgreSQL); one box per name.
            if (!seenNames.Add(entry.Name)) continue;
            var actor = new JsonObject
            {
                ["id"] = candidate,
                ["kind"] = "external_system",
                ["name"] = entry.Name,
                ["description"] = $"Detected via the '{candidate}' dependency.",
            };
            if (!string.IsNullOrEmpty(entry.Icon)) actor["icon"] = entry.Icon;
            nodes.Add(actor);
            relations.Add(new JsonObject { ["from"] = "system", ["to"] = candidate, ["label"] = "Uses" });
        }
        return new JsonObject
        {
            ["type"] = "c1",
            ["style"] = "boxes-arrows",
            ["nodes"] = nodes,
            ["relations"] = relations,
            ["draft"] = true,
        };
    }

    private static IEnumerable<string> Candidates(JsonObject digest)
    {
        if (digest["declared_dependencies"] is JsonArray declared)
            foreach (var item in declared)
                if (Json.Str(item) is { } text) yield return text;
        if (digest["external_import_roots"] is JsonArray roots)
            foreach (var entry in roots)
                if (entry is JsonObject o && Json.Str(o["root"]) is { } root) yield return root;
    }
}
