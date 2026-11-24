using System.Text.Json.Nodes;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Agents;

/// <summary>GET /agents/models: the models the "Run new agent" long-press menu offers, for the connection new agent windows run on.</summary>
public static class AgentModelChoices
{
    /// <summary>{provider_id, provider_name, adapter, current, models, source, error}: Claude Code's cached catalog first, else the provider listing the LLM settings use.</summary>
    public static async Task<JsonObject> For(CallSiteStore sites, ProviderStore providers, UserPaths paths, RuntimeEnvironment? runtime, string? catalogDir = null)
    {
        var assignment = sites.EffectiveAssignment(TerminalAgents.AgentCallSite);
        var providerId = assignment is not null && Json.Str(assignment["mode"]) == "cli" ? Json.Str(assignment["provider_id"]) : null;
        var provider = providerId is null ? null : providers.Find(providerId);
        var current = provider is not null ? Json.Str(assignment!["model"]) : Json.Str(AssistantRoutes.Load(paths)["model"]);
        var source = provider ?? new JsonObject { ["kind"] = "cli", ["adapter"] = TerminalAgents.DefaultCli };
        var adapter = Json.Str(source["kind"]) == "cli" ? Json.Str(source["adapter"]) : "claude";
        var reply = new JsonObject
        {
            ["provider_id"] = provider is null ? null : providerId,
            ["provider_name"] = provider is null ? null : Json.Str(provider["label"]),
            ["adapter"] = adapter,
            ["current"] = string.IsNullOrEmpty(current) ? null : current,
            ["error"] = null,
        };
        var usesClaudeAccount = Json.Str(source["kind"]) == "cli" && adapter == "claude" && string.IsNullOrEmpty(Json.Str(source["base_url"]));
        if (usesClaudeAccount && ClaudeModelCatalog.Models(catalogDir ?? ClaudeModelCatalog.DefaultDir()) is { Count: > 0 } cached)
        {
            reply["models"] = cached;
            reply["source"] = "cache";
            return reply;
        }
        var listing = await ModelCatalog.Fetch(source, runtime);
        reply["models"] = (listing["models"] as JsonArray)?.DeepClone() ?? new JsonArray();
        reply["source"] = listing["static"] is not null ? "static" : "catalog";
        reply["error"] = listing["error"]?.DeepClone();
        return reply;
    }
}
