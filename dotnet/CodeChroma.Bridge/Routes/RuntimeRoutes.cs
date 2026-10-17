using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET/PUT /runtime/settings plus the login-shell diagnostics routes (environment, cli/{name}, refresh, focus).</summary>
public static class RuntimeRoutes
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/runtime/settings", (UserPaths paths) => Reply.Json(Load(paths)));

        app.MapPut("/runtime/settings", async (HttpRequest request, UserPaths paths, RuntimeEnvironment runtime) =>
        {
            var body = await Reply.LenientBody(request);
            try
            {
                var settings = Validate(body);
                JsonFile.Write(paths.Runtime, settings);
                await Task.Run(() => runtime.Configure(RuntimeSettings.From(settings)).GetAwaiter().GetResult());
                return Reply.Json(settings);
            }
            catch (ArgumentException error)
            {
                return Reply.Error(400, error.Message);
            }
        });

        app.MapGet("/runtime/environment", (RuntimeEnvironment runtime) => Reply.Json(runtime.Snapshot().Diagnostics()));

        app.MapGet("/runtime/cli/{name}", (string name, RuntimeEnvironment runtime) => Reply.Json(runtime.Diagnose(name)));

        app.MapPost("/runtime/refresh", async (RuntimeEnvironment runtime) =>
            Reply.Json((await runtime.Refresh("user Re-detect", force: true)).Diagnostics()));

        app.MapPost("/runtime/focus", async (RuntimeEnvironment runtime) =>
            Reply.Json((await Task.Run(runtime.RecheckUnresolved)).Diagnostics()));
    }

    public static JsonObject Load(UserPaths paths)
    {
        try
        {
            return Validate(JsonFile.LoadObject(paths.Runtime));
        }
        catch (ArgumentException)
        {
            return Validate([]);
        }
    }

    private static JsonObject Validate(JsonObject payload)
    {
        var shell = payload["shell"];
        if (shell is not null && (Json.Str(shell) is not { } s || Json.IsBlank(s)))
            throw new ArgumentException("shell must be a non-empty executable path or null");
        var timeout = payload.ContainsKey("timeout_seconds") ? payload["timeout_seconds"] : JsonValue.Create(10.0);
        if (timeout is not JsonValue tv || tv.GetValueKind() != JsonValueKind.Number
            || tv.GetValue<double>() is var seconds && (double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0.1 || seconds > 60))
            throw new ArgumentException("timeout_seconds must be between 0.1 and 60");
        var paths = payload.ContainsKey("cli_paths") ? payload["cli_paths"] : new JsonObject();
        if (paths is not JsonObject map || map.Any(kv => !ExplicitPath(kv.Key, Json.Str(kv.Value))))
            throw new ArgumentException("cli_paths must map executable names to explicit executable paths");
        return new JsonObject
        {
            ["shell"] = shell?.DeepClone(),
            ["timeout_seconds"] = timeout.GetValue<double>(),
            ["cli_paths"] = map.DeepClone(),
        };
    }

    private static bool ExplicitPath(string name, string? path) =>
        !Json.IsBlank(name) && Path.GetFileName(name) == name
        && path is not null && !Json.IsBlank(path) && !string.IsNullOrEmpty(Path.GetDirectoryName(path));
}
