using System.Text.Json.Nodes;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Skills;

/// <summary>The one-shot (quick) provider of a call site, as Python's build_provider and resolve_model: its assignment, else the assistant's key or env.</summary>
public sealed class QuickLlm(UserPaths paths, ProviderStore providers, CallSiteStore sites, HttpClient http)
{
    public (ILlmCompletion? Provider, string Model) Resolve(string callSiteId, string defaultModel)
    {
        var assignment = sites.EffectiveAssignment(callSiteId);
        var mode = Json.Str(assignment?["mode"]);
        var model = mode == "api" && Json.Str(assignment!["model"]) is { } assigned ? assigned : defaultModel;
        return (Build(assignment, mode), model);
    }

    private ILlmCompletion? Build(JsonObject? assignment, string? mode)
    {
        // mode="cli" has no direct-API path here: it falls back to the assistant's key, like an unassigned site.
        if (mode == "offline") return null;
        if (mode != "api") return Legacy();
        var provider = providers.Find(Json.Str(assignment!["provider_id"]) ?? "");
        if (provider is not null && Json.Str(provider["kind"]) == "cli") return ClaudeCliKey(provider);
        return provider is null || Json.Str(provider["kind"]) != "api" ? Legacy() : LlmCompletion.For(provider, http);
    }

    private ILlmCompletion? Legacy()
    {
        var assistant = AssistantRoutes.Load(paths);
        return LlmCompletion.ForAssistant(Json.Str(assistant["api_key"]), Json.Str(assistant["api_key_path"]), http);
    }

    /// <summary>A keyed `claude` CLI connection answers one-shot calls through the Anthropic API.</summary>
    private ILlmCompletion? ClaudeCliKey(JsonObject provider)
    {
        if (Json.Str(provider["adapter"]) != "claude" || ProviderKeys.Resolve(provider) is null) return null;
        var asApi = (JsonObject)provider.DeepClone();
        asApi["kind"] = "api";
        asApi["transport"] = "anthropic";
        return LlmCompletion.For(asApi, http);
    }
}
