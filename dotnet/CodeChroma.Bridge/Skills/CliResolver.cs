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
        var assignment = sites.EffectiveAssignment(callSiteId);
        if (assignment is not null && Json.Str(assignment["mode"]) == "cli"
            && CliProvider(Json.Str(assignment["provider_id"]) ?? "") is ({ } provider, { } adapter))
        {
            var model = Json.Str(assignment["model"])!;
            return new CliResolution(adapter, adapter, model, EnvOverrides(provider, model), true);
        }
        var assistant = AssistantRoutes.Load(paths);
        var assistantModel = Json.Str(assistant["model"]) is { Length: > 0 } m ? m : defaultModel;
        return new CliResolution("claude", AssistantRoutes.EffectiveCli(paths), assistantModel, new Dictionary<string, string>(), false);
    }

    /// <summary>One provider's CLI with an explicit model (null: the provider's test model); throws for an unknown or non-CLI provider.</summary>
    public CliResolution ResolveProvider(string providerId, string? model)
    {
        if (CliProvider(providerId) is not ({ } provider, { } adapter)) throw new CliLookupException($"unknown CLI provider: {providerId}");
        var chosen = model ?? Json.Str(provider["test_model"]) ?? "";
        return new CliResolution(adapter, adapter, chosen, EnvOverrides(provider, chosen), true);
    }

    /// <summary>The CLI adapter a provider id runs (null: the call site's own resolution), or null for an unknown or non-CLI provider.</summary>
    public string? AdapterOf(string? providerId, string callSiteId, string defaultModel) =>
        providerId is null ? Resolve(callSiteId, defaultModel).AdapterKey : CliProvider(providerId).Adapter;

    /// <summary>A CLI provider with a known adapter, or an anthropic API provider (run through claude); (null, null) otherwise.</summary>
    private (JsonObject? Provider, string? Adapter) CliProvider(string providerId)
    {
        if (providers.Find(providerId) is not { } provider) return (null, null);
        if (IsAnthropicApi(provider)) return (provider, "claude");
        return Json.Str(provider["kind"]) == "cli" && Json.Str(provider["adapter"]) is { } adapter && CliAdapters.All.ContainsKey(adapter)
            ? (provider, adapter)
            : (null, null);
    }

    private static bool IsAnthropicApi(JsonObject provider) => Json.Str(provider["kind"]) == "api" && Json.Str(provider["transport"]) == "anthropic";

    /// <summary>The same CLI on another model; a provider that pins the model through ANTHROPIC_MODEL gets it there too.</summary>
    public static CliResolution WithModel(CliResolution cli, string model)
    {
        if (!cli.EnvOverrides.ContainsKey("ANTHROPIC_MODEL")) return cli with { Model = model };
        var env = new Dictionary<string, string>(cli.EnvOverrides) { ["ANTHROPIC_MODEL"] = model };
        return cli with { Model = model, EnvOverrides = env };
    }

    /// <summary>Claude providers with a base_url, or an anthropic API key, get env vars; ANTHROPIC_MODEL not --model.</summary>
    private static Dictionary<string, string> EnvOverrides(JsonObject provider, string model)
    {
        var overrides = new Dictionary<string, string>();
        if (IsAnthropicApi(provider))
        {
            var apiKey = ProviderKeys.Resolve(provider) ?? "";
            if (Json.Str(provider["base_url"]) is not { Length: > 0 } proxy)
            {
                // api.anthropic.com takes an sk-ant key only as x-api-key, never as a Bearer token
                overrides["ANTHROPIC_API_KEY"] = apiKey;
                overrides["ANTHROPIC_MODEL"] = model;
                return overrides;
            }
            overrides["ANTHROPIC_BASE_URL"] = proxy;
            overrides["ANTHROPIC_API_KEY"] = "";
            overrides["ANTHROPIC_MODEL"] = model;
            if (apiKey.Length > 0) overrides["ANTHROPIC_AUTH_TOKEN"] = apiKey;
            return overrides;
        }
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
