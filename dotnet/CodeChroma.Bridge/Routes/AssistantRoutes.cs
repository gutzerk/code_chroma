using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET/PUT /assistant/settings and the connection probe; the settings file is machine-local, not per repo.</summary>
public static class AssistantRoutes
{
    private const string DefaultCli = "claude";

    public static void Map(WebApplication app)
    {
        app.MapGet("/assistant/settings", (UserPaths paths) => Reply.Json(Masked(Load(paths))));

        app.MapPut("/assistant/settings", async (HttpRequest request, UserPaths paths) =>
        {
            var body = await Reply.LenientBody(request);
            if (body.ContainsKey("api_key_set") && !body.ContainsKey("api_key")) body["api_key"] = null;
            var problems = Validate(body);
            if (problems.Count > 0) return Reply.Error(400, string.Join("; ", problems));
            if (Json.Str(body["api_key"]) == "") body["api_key"] = null;
            var settings = FromPayload(body);
            JsonFile.Write(paths.Assistant, new JsonObject
            {
                ["schema_version"] = settings["schema_version"]?.DeepClone(),
                ["cli"] = settings["cli"]!.DeepClone(),
                ["model"] = settings["model"]?.DeepClone(),
                ["api_key"] = settings["api_key"]?.DeepClone(),
                ["api_key_path"] = settings["api_key_path"]?.DeepClone(),
                ["instruction"] = settings["instruction"]!.DeepClone(),
            });
            return Reply.Json(Masked(settings));
        });

        app.MapPost("/assistant/settings/test", (UserPaths paths) =>
        {
            var settings = Load(paths);
            var cli = Json.Str(settings["cli"])!;
            var cliFound = CliLocator.Find(cli) is not null;
            var source = KeySource(settings);
            var problems = new List<string>();
            if (!cliFound) problems.Add($"{cli} was not found on PATH");
            if (source == "none")
                problems.Add("no API key configured (settings file, key path, or ANTHROPIC_API_KEY)");
            else
                problems.Add("the API probe call is not available in the C# bridge yet");
            return Reply.Json(new JsonObject
            {
                ["ok"] = false, ["cli"] = cli, ["cli_found"] = cliFound, ["auth_source"] = source,
                ["error"] = string.Join("; ", problems),
            });
        });
    }

    public static JsonObject Load(UserPaths paths) => FromPayload(JsonFile.LoadObject(paths.Assistant));

    /// <summary>The CLI the assistant runs: the saved one, else claude.</summary>
    public static string EffectiveCli(UserPaths paths) => Json.Str(Load(paths)["cli"]) is { Length: > 0 } cli ? cli : DefaultCli;

    private static string KeySource(JsonObject settings)
    {
        if (Json.Truthy(settings["api_key"])) return "settings";
        if (Json.Truthy(settings["api_key_path"])) return "file";
        return string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")) ? "none" : "env";
    }

    private static JsonObject FromPayload(JsonObject payload)
    {
        var cli = Json.Str(payload["cli"]);
        var model = Json.Str(payload["model"]);
        return new JsonObject
        {
            ["schema_version"] = payload.ContainsKey("schema_version") ? payload["schema_version"]?.DeepClone() : 1,
            ["cli"] = cli is not null && !Json.IsBlank(cli) ? cli : DefaultCli,
            ["model"] = model is not null && !Json.IsBlank(model) ? model : null,
            ["api_key"] = Json.Str(payload["api_key"]),
            ["api_key_path"] = Json.Str(payload["api_key_path"]),
            ["instruction"] = Json.Str(payload["instruction"]) ?? "",
        };
    }

    private static JsonObject Masked(JsonObject settings) => new()
    {
        ["schema_version"] = settings["schema_version"]?.DeepClone(),
        ["cli"] = settings["cli"]!.DeepClone(),
        ["model"] = settings["model"]?.DeepClone(),
        ["api_key_set"] = Json.Truthy(settings["api_key"]),
        ["api_key_path"] = settings["api_key_path"]?.DeepClone(),
        ["instruction"] = settings["instruction"]!.DeepClone(),
    };

    private static List<string> Validate(JsonObject payload)
    {
        var problems = new List<string>();
        var cli = payload.ContainsKey("cli") ? payload["cli"] : JsonValue.Create(DefaultCli);
        var cliText = Json.Str(cli);
        if (cliText is null || Json.IsBlank(cliText) || cliText.Contains('/') || cliText is "." or "..")
            problems.Add("cli must be a simple executable name (no slashes)");
        if (payload["model"] is { } model && (Json.Str(model) is not { } m || Json.IsBlank(m)))
            problems.Add("model must be a non-empty string");
        if (payload["api_key_path"] is { } keyPath && (Json.Str(keyPath) is not { } p || Json.IsBlank(p)))
            problems.Add("api_key_path must be a non-empty string");
        if (Json.Truthy(payload["api_key"]) && Json.Truthy(payload["api_key_path"]))
            problems.Add("provide an api_key OR an api_key_path, not both");
        if (payload.ContainsKey("instruction") && !Json.IsString(payload["instruction"]))
            problems.Add("instruction must be a string");
        return problems;
    }
}
