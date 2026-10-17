using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Skills;

/// <summary>The status/output ping pair every generate route wires its runner with, and the cancel-then-ping body.</summary>
public static class SkillJobCallbacks
{
    public static (OnChange OnChange, OnOutput OnOutput) For(string kind, Action<JsonObject> emit, JsonObject? extras = null) =>
        (
            (_, state) =>
            {
                emit(Event($"{kind}-status", extras, ("state", state.State), ("error", state.Error)));
                return Task.CompletedTask;
            },
            (_, lines) =>
            {
                emit(Event($"{kind}-output", extras, ("lines", new JsonArray(lines.Select(l => (JsonNode?)l).ToArray()))));
                return Task.CompletedTask;
            });

    /// <summary>Cancels an in-flight run (its artifact rolls back) and pings canvases to leave the panel.</summary>
    public static async Task<JobState> StopAndNotify(SkillAgent agent, string key, string kind, Action<JsonObject> emit, JsonObject? extras = null)
    {
        var state = await agent.Stop(key);
        emit(Event($"{kind}-status", extras, ("state", state.State), ("error", state.Error)));
        return state;
    }

    private static JsonObject Event(string type, JsonObject? extras, params (string Key, object? Value)[] fields)
    {
        var message = new JsonObject { ["type"] = type };
        foreach (var (k, v) in extras ?? []) message[k] = v?.DeepClone();
        foreach (var (k, v) in fields) message[k] = v is JsonNode node ? node : JsonValue.Create(v as string);
        return message;
    }
}

public static class SkillServices
{
    /// <summary>Registers the runtime environment, CLI resolver, skill runners and LLM completion client.</summary>
    public static IServiceCollection AddSkillServices(this IServiceCollection services)
    {
        services.AddSingleton(sp => new RuntimeEnvironment(() => RuntimeSettings.From(RuntimeRoutes.Load(sp.GetRequiredService<UserPaths>()))));
        services.AddSingleton<CliResolver>();
        services.AddSingleton<SkillAgents>();
        return services;
    }
}
