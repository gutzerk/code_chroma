using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
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
            if (body.Count == 1 && body.ContainsKey("instruction"))
            {
                var stored = Load(paths);
                stored["instruction"] = body["instruction"]?.DeepClone();
                body = stored;
            }
            else if (body.ContainsKey("api_key_set") && !body.ContainsKey("api_key")) body["api_key"] = null;
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

        app.MapPost("/assistant/settings/test", async (UserPaths paths, RuntimeEnvironment runtime, HttpClient http) =>
        {
            var settings = Load(paths);
            var cli = Json.Str(settings["cli"])!;
            var problems = new List<string>();
            bool cliFound;
            try
            {
                await Task.Run(() => runtime.Resolve(cli));
                cliFound = true;
            }
            catch (CliLookupException error)
            {
                cliFound = false;
                problems.Add(error.Message);
            }
            var source = KeySource(settings);
            if (source == "none")
            {
                problems.Add("no API key configured (settings file, key path, or ANTHROPIC_API_KEY)");
                return Reply.Json(Probe(false, cli, cliFound, source, string.Join("; ", problems)));
            }
            var llm = LlmCompletion.ForAssistant(Json.Str(settings["api_key"]), Json.Str(settings["api_key_path"]), http);
            try
            {
                var text = await llm!.Complete("Reply with the single word: ok", LlmCompletion.ProbeModel, 1);
                return Reply.Json(Probe(true, cli, cliFound, source, message: text.Length > 40 ? text[..40] : text));
            }
            catch (Exception error)
            {
                return Reply.Json(Probe(false, cli, cliFound, source, error.Message));
            }
        });
    }

    private static JsonObject Probe(bool ok, string cli, bool cliFound, string source, string? error = null, string? message = null)
    {
        var result = new JsonObject { ["ok"] = ok, ["cli"] = cli, ["cli_found"] = cliFound, ["auth_source"] = source };
        if (error is not null) result["error"] = error;
        if (message is not null) result["message"] = message;
        return result;
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
