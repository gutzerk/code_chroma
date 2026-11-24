using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Agents;

/// <summary>GET /agents/models: the models the "Run new agent" long-press menu offers, for the connection new agent windows run on.</summary>
public static class AgentModelChoices
{
    /// <summary>{provider_name, current, current_id, models, source, error}: Claude Code's cached catalog first, else the provider listing the LLM settings use.</summary>
    public static async Task<JsonObject> For(CallSiteStore sites, ProviderStore providers, UserPaths paths, Skills.RuntimeEnvironment? runtime, string? catalogDir = null)
    {
        var (cli, provider) = new Skills.CliResolver(paths, providers, sites).ResolveWithProvider(TerminalAgents.AgentCallSite, "");
        var reply = new JsonObject
        {
            ["provider_name"] = provider is null ? null : Json.Str(provider["label"]),
            ["current"] = cli.Model.Length == 0 ? null : cli.Model,
            ["error"] = null,
        };
        var usesClaudeAccount = cli.AdapterKey == TerminalAgents.DefaultCli && cli.EnvOverrides.Count == 0;
        if (usesClaudeAccount && ClaudeModelCatalog.Models(catalogDir ?? ClaudeModelCatalog.DefaultDir()) is { Count: > 0 } cached)
        {
            reply["models"] = cached;
            reply["source"] = "cache";
            reply["current_id"] = CurrentId(cached, cli.Model);
            return reply;
        }
        var listing = await ModelCatalog.Fetch(provider ?? new JsonObject { ["kind"] = "cli", ["adapter"] = cli.AdapterKey }, runtime);
        var models = listing["models"];
        var error = listing["error"];
        listing.Remove("models");
        listing.Remove("error");
        var listed = models as JsonArray ?? new JsonArray();
        reply["models"] = listed;
        reply["source"] = listing["supported"] is JsonValue s && s.TryGetValue<bool>(out var ok) && !ok ? "unsupported" : listing["static"] is not null ? "static" : "catalog";
        reply["current_id"] = CurrentId(listed, cli.Model);
        reply["error"] = error;
        return reply;
    }

    /// <summary>The listed id the configured model names: the same id, the same base id, or the first listed `claude-ALIAS-*` for a claude alias; null when none.</summary>
    public static string? CurrentId(JsonArray models, string current)
    {
        if (current.Length == 0) return null;
        var ids = models.Select(m => Json.Str(m?["id"])).OfType<string>().ToList();
        var exact = ids.FirstOrDefault(id => id == current) ?? ids.FirstOrDefault(id => ClaudeModelCatalog.BaseId(id) == ClaudeModelCatalog.BaseId(current));
        if (exact is not null) return exact;
        return current.All(char.IsAsciiLetterLower) ? ids.FirstOrDefault(id => id.StartsWith($"claude-{current}-", StringComparison.Ordinal)) : null;
    }
}
