using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Terminal;

/// <summary>A CLI could not be found, with the reason the user is shown verbatim.</summary>
public sealed class CliLookupException(string message) : Exception(message);

/// <summary>Finds a CLI by name, honouring an explicit path from the runtime settings before PATH.</summary>
public static class CliResolver
{
    public static string Resolve(string name, UserPaths? paths = null)
    {
        if (paths is not null && RuntimeRoutes.Load(paths)["cli_paths"] is JsonObject configured && Json.Str(configured[name]) is { Length: > 0 } explicitPath)
        {
            if (!File.Exists(explicitPath))
                throw new CliLookupException($"Configured CLI path '{explicitPath}' does not exist.");
            return explicitPath;
        }
        if (Path.IsPathRooted(name) && File.Exists(name)) return name;
        return CliLocator.Find(name) ?? throw new CliLookupException(
            $"'{name}' executable not found on PATH (process environment). Install it, click Re-detect, or configure its executable path. "
            + "Shell aliases/functions are not executable CLI paths.");
    }
}

/// <summary>What an agent window launches: argv plus provider environment (terminal/agents.py).</summary>
public sealed record AgentLaunch(IReadOnlyList<string> Argv, IReadOnlyDictionary<string, string> Env);

/// <summary>
/// The allow-list of commands the terminal server may spawn, keyed by a client-supplied name. The front end names a key, never a
/// command. The `agent` row is provider-routed: its real argv is resolved at launch through the LLM provider settings.
/// </summary>
public sealed class TerminalAgents(UserPaths paths, ProviderStore providers, CallSiteStore callSites)
{
    public const string ResumeFlag = "--resume";
    public const string AgentCallSite = "parallel_agents";
    public const string DefaultCli = "claude";

    /// <summary>The allow-list: shell is a login terminal, claude launches the assistant CLI, agent is a placeholder that is never executed.</summary>
    public static IReadOnlyDictionary<string, string[]> Allowed { get; } = new Dictionary<string, string[]>
    {
        ["shell"] = OperatingSystem.IsWindows()
            ? [Environment.GetEnvironmentVariable("COMSPEC") ?? "cmd.exe"]
            : [Environment.GetEnvironmentVariable("SHELL") ?? "/bin/bash", "-l"],
        ["claude"] = ["claude"],
        ["agent"] = [],
    };

    /// <summary>An allow-listed agent's argv and provider environment, or null for an unknown kind.</summary>
    public AgentLaunch? Resolve(string agent, string? resumeSessionId = null, string? initialPrompt = null)
    {
        if (agent == "agent")
        {
            var resolution = ResolveProviderCli(AgentCallSite);
            var plugin = PluginArgs(resolution.AdapterKey == "claude" && (resolution.ProviderAssigned || resolution.Binary == DefaultCli));
            return new AgentLaunch([resolution.Binary, .. plugin, .. ResumePrompt(resumeSessionId, initialPrompt)], resolution.Env);
        }
        if (!Allowed.TryGetValue(agent, out var entry)) return null;
        if (agent == "claude")
        {
            var binary = AssistantRoutes.EffectiveCli(paths);
            return new AgentLaunch([binary, .. PluginArgs(binary == DefaultCli), .. ResumePrompt(resumeSessionId, initialPrompt)], new Dictionary<string, string>());
        }
        return new AgentLaunch(string.IsNullOrEmpty(resumeSessionId) ? entry : [.. entry, ResumeFlag, resumeSessionId], new Dictionary<string, string>());
    }

    /// <summary>The label persisted on AgentRecord.ResolvedCli: only `agent` windows report one.</summary>
    public static string ResolvedCliFor(string kind, IReadOnlyList<string> argv) => kind == "agent" ? argv[0] : "";

    private sealed record CliResolution(string AdapterKey, string Binary, Dictionary<string, string> Env, bool ProviderAssigned);

    private CliResolution ResolveProviderCli(string callSiteId)
    {
        var assignment = AssignmentFor(callSiteId);
        if (assignment is not null && Json.Str(assignment["mode"]) == "cli"
            && providers.Find(Json.Str(assignment["provider_id"]) ?? "") is { } provider
            && Json.Str(provider["kind"]) == "cli" && Json.Str(provider["adapter"]) is { } adapter && LlmCatalog.Adapters.Contains(adapter))
            return new CliResolution(adapter, adapter, EnvOverrides(provider, Json.Str(assignment["model"]) ?? ""), true);
        return new CliResolution("claude", AssistantRoutes.EffectiveCli(paths), [], false);
    }

    private JsonObject? AssignmentFor(string callSiteId)
    {
        if (LlmCatalog.GroupOf(callSiteId) is { } group)
        {
            if (!callSites.GroupAssignments().TryGetValue(group, out var grouped)) return null;
            return new JsonObject { ["provider_id"] = grouped["provider_id"]!.DeepClone(), ["model"] = grouped["model"]!.DeepClone(), ["mode"] = "cli" };
        }
        return callSites.Assignments().GetValueOrDefault(callSiteId);
    }

    /// <summary>Only claude providers with a base_url get env vars. AUTH_TOKEN not API_KEY (API_KEY wins precedence); ANTHROPIC_MODEL not --model (the CLI rejects it).</summary>
    private static Dictionary<string, string> EnvOverrides(JsonObject provider, string model)
    {
        var overrides = new Dictionary<string, string>();
        if (Json.Str(provider["adapter"]) != "claude" || Json.Str(provider["base_url"]) is not { Length: > 0 } baseUrl) return overrides;
        overrides["ANTHROPIC_BASE_URL"] = baseUrl;
        overrides["ANTHROPIC_API_KEY"] = "";
        overrides["ANTHROPIC_MODEL"] = model;
        if (ProviderKey(provider) is { Length: > 0 } key) overrides["ANTHROPIC_AUTH_TOKEN"] = key;
        if (provider["verify_ssl"] is JsonValue verify && verify.TryGetValue<bool>(out var check) && !check) overrides["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
        return overrides;
    }

    private static string? ProviderKey(JsonObject provider)
    {
        if (Json.Str(provider["api_key"]) is { Length: > 0 } key) return key;
        if (Json.Str(provider["api_key_path"]) is not { Length: > 0 } path) return null;
        try
        {
            return File.ReadLines(path).Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0 && !l.StartsWith('#'));
        }
        catch (IOException) { return null; }
    }

    /// <summary>Load CodeChroma skills for this Claude Code process without changing its project.</summary>
    private static string[] PluginArgs(bool isClaude) => isClaude && SkillSync.PluginDir() is { } dir ? ["--plugin-dir", dir] : [];

    private static string[] ResumePrompt(string? resumeSessionId, string? initialPrompt)
    {
        if (!string.IsNullOrEmpty(resumeSessionId)) return [ResumeFlag, resumeSessionId];
        return string.IsNullOrEmpty(initialPrompt) ? [] : [initialPrompt];
    }
}
