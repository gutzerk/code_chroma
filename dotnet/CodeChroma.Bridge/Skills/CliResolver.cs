using System.Text.Json.Nodes;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Skills;

/// <summary>Which CLI (adapter, binary, model, env overrides) a call site runs, and whether a provider chose it.</summary>
public sealed record CliResolution(string AdapterKey, string Binary, string Model, IReadOnlyDictionary<string, string> EnvOverrides, bool ProviderAssigned);

/// <summary>The call site to provider to adapter to binary/model/env algorithm, with the assistant settings as fallback.</summary>
public sealed class CliResolver(UserPaths paths, ProviderStore providers, CallSiteStore sites)
{
    public CliResolution Resolve(string callSiteId, string defaultModel)
    {
        var assignment = LoadAssignment(callSiteId);
        if (assignment is not null && Json.Str(assignment["mode"]) == "cli"
            && providers.Find(Json.Str(assignment["provider_id"]) ?? "") is { } provider
            && Json.Str(provider["kind"]) == "cli"
            && Json.Str(provider["adapter"]) is { } adapter && CliAdapters.All.ContainsKey(adapter))
        {
            var model = Json.Str(assignment["model"])!;
            return new CliResolution(adapter, adapter, model, EnvOverrides(provider, model), true);
        }
        var assistant = AssistantRoutes.Load(paths);
        var assistantModel = Json.Str(assistant["model"]) is { Length: > 0 } m ? m : defaultModel;
        return new CliResolution("claude", AssistantRoutes.EffectiveCli(paths), assistantModel, new Dictionary<string, string>(), false);
    }

    /// <summary>The effective assignment: an agentic call site uses its group's, a simple one its own.</summary>
    private JsonObject? LoadAssignment(string callSiteId)
    {
        if (LlmCatalog.GroupOf(callSiteId) is { } group)
        {
            var assigned = sites.GroupAssignments().GetValueOrDefault(group);
            return assigned is null ? null : new JsonObject
            {
                ["provider_id"] = assigned["provider_id"]!.DeepClone(), ["model"] = assigned["model"]!.DeepClone(), ["mode"] = "cli",
            };
        }
        return sites.Assignments().GetValueOrDefault(callSiteId);
    }

    /// <summary>Only claude providers with a base_url get env vars; AUTH_TOKEN not API_KEY, ANTHROPIC_MODEL not --model.</summary>
    private static Dictionary<string, string> EnvOverrides(JsonObject provider, string model)
    {
        var overrides = new Dictionary<string, string>();
        if (Json.Str(provider["adapter"]) != "claude" || Json.Str(provider["base_url"]) is not { Length: > 0 } baseUrl) return overrides;
        overrides["ANTHROPIC_BASE_URL"] = baseUrl;
        overrides["ANTHROPIC_API_KEY"] = "";
        overrides["ANTHROPIC_MODEL"] = model;
        if (ProviderKeys.Resolve(provider) is { } key) overrides["ANTHROPIC_AUTH_TOKEN"] = key;
        if (provider["verify_ssl"] is JsonValue v && v.TryGetValue(out bool verify) && !verify) overrides["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
        return overrides;
    }
}

/// <summary>A provider's own key or key file, with the same precedence the assistant settings use.</summary>
public static class ProviderKeys
{
    public static string? Resolve(JsonObject provider) => From(Json.Str(provider["api_key"]), Json.Str(provider["api_key_path"]));

    public static string? From(string? apiKey, string? apiKeyPath)
    {
        if (!string.IsNullOrEmpty(apiKey)) return apiKey;
        return string.IsNullOrEmpty(apiKeyPath) ? null : ReadKeyFile(apiKeyPath);
    }

    /// <summary>The first non-empty, non-comment line of a credentials file; null when unreadable.</summary>
    public static string? ReadKeyFile(string path)
    {
        try
        {
            var expanded = path.StartsWith('~') ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + path[1..] : path;
            return File.ReadLines(expanded).Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0 && !l.StartsWith('#'));
        }
        catch (IOException)
        {
            return null;
        }
    }
}
