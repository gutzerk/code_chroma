using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Skills;
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
public sealed class TerminalAgents(UserPaths paths, ProviderStore providers, CallSiteStore callSites, QuestionMcp? questions = null)
{
    public const string ResumeFlag = ClaudeAdapter.ResumeFlag;
    public const string ForkSessionFlag = ClaudeAdapter.ForkSessionFlag;
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

    /// <summary>An allow-listed agent's argv and provider environment, or null for an unknown kind; `forkSession` (claude only) resumes into a new session.</summary>
    public AgentLaunch? Resolve(string agent, string? resumeSessionId = null, string? initialPrompt = null, bool bare = false, string? visiblePrompt = null, bool forkSession = false, string? agentId = null, string? bridgeUrl = null, string? newSessionId = null, string? sessionTrackingFile = null)
    {
        if (agent == "agent")
        {
            var resolution = ResolveProviderCli(AgentCallSite);
            var isClaude = resolution.AdapterKey == "claude" && (resolution.ProviderAssigned || resolution.Binary == DefaultCli);
            var mcp = EndpointFor(agentId, bridgeUrl, isClaude, bare);
            var argv = Argv(resolution.Binary, isClaude, resolution.AdapterKey, resumeSessionId, initialPrompt, bare, visiblePrompt, mcp);
            return OwnedLaunch(argv, WithEnv(resolution.Env, mcp), isClaude, resumeSessionId, forkSession, newSessionId, sessionTrackingFile, mcp is not null);
        }
        if (!Allowed.TryGetValue(agent, out var entry)) return null;
        if (agent == "claude")
        {
            var binary = AssistantRoutes.EffectiveCli(paths);
            var mcp = EndpointFor(agentId, bridgeUrl, binary == DefaultCli, bare);
            var argv = Argv(binary, binary == DefaultCli, "claude", resumeSessionId, initialPrompt, bare, visiblePrompt, mcp);
            return OwnedLaunch(argv, WithEnv([], mcp), binary == DefaultCli, resumeSessionId, forkSession, newSessionId, sessionTrackingFile, mcp is not null);
        }
        return new AgentLaunch(string.IsNullOrEmpty(resumeSessionId) ? entry : [.. entry, ResumeFlag, resumeSessionId], new Dictionary<string, string>());
    }

    /// <summary>Whether a bare launch of this kind carries a `--system-prompt` the skill can ride in, so an empty visible prompt really leaves the CLI waiting for the user.</summary>
    public bool SplitsSystemPrompt(string kind)
    {
        var adapterKey = kind switch { "claude" => "claude", "agent" => ResolveProviderCli(AgentCallSite).AdapterKey, _ => null };
        if (adapterKey is null || !CliAdapters.All.TryGetValue(adapterKey, out var adapter)) return false;
        var bareArgs = adapter.BareArgs(CliAdapters.DefaultBareTools);
        var promptAt = Array.IndexOf(bareArgs.ToArray(), "--system-prompt");
        return promptAt >= 0 && promptAt + 1 < bareArgs.Count();
    }

    /// <summary>The ask_user endpoint for a Claude window, or null for other CLIs, bare windows, no agent id or before the bridge URL is known.</summary>
    private McpEndpoint? EndpointFor(string? agentId, string? bridgeUrl, bool isClaude, bool bare) =>
        questions is not null && isClaude && !bare && !string.IsNullOrEmpty(agentId) && !string.IsNullOrEmpty(bridgeUrl) ? questions.EndpointFor(agentId, bridgeUrl) : null;

    private static Dictionary<string, string> WithEnv(Dictionary<string, string> env, McpEndpoint? mcp)
    {
        if (mcp is null) return env;
        var merged = new Dictionary<string, string>(env);
        foreach (var (key, value) in mcp.Env()) merged[key] = value;
        return merged;
    }

    private static AgentLaunch OwnedLaunch(string[] argv, IReadOnlyDictionary<string, string> env, bool isClaude, string? resumeSessionId, bool fork, string? newSessionId, string? trackingFile, bool hasMcp = false)
    {
        if (!isClaude) return new AgentLaunch(argv, env);
        var options = new List<string>();
        if (fork && !string.IsNullOrEmpty(resumeSessionId)) options.Add(ForkSessionFlag);
        var fresh = string.IsNullOrEmpty(resumeSessionId) || fork;
        if (fresh && !string.IsNullOrEmpty(newSessionId)) options.AddRange(["--session-id", newSessionId]);
        var ownedEnv = new Dictionary<string, string>(env);
        if (trackingFile is not null || hasMcp) options.AddRange(["--settings", AgentSessionOwnership.HookSettings(trackingFile is not null, hasMcp)]);
        if (trackingFile is not null)
        {
            ownedEnv[AgentSessionOwnership.FileEnv] = trackingFile;
            ownedEnv[AgentSessionOwnership.InitialIdEnv] = (fresh ? newSessionId : resumeSessionId) ?? "";
        }
        // Options precede the prompt and the variadic --plugin-dir / --allowedTools options.
        return new AgentLaunch([argv[0], .. options, .. argv.Skip(1)], ownedEnv);
    }

    /// <summary>The label persisted on AgentRecord.ResolvedCli: only `agent` windows report one.</summary>
    public static string ResolvedCliFor(string kind, IReadOnlyList<string> argv) => kind == "agent" ? argv[0] : "";

    private sealed record CliResolution(string AdapterKey, string Binary, Dictionary<string, string> Env, bool ProviderAssigned);

    /// <summary>The shared CliResolver, as the Python agent window shares resolve_cli: overrides, the default, and anthropic API providers.</summary>
    private CliResolution ResolveProviderCli(string callSiteId)
    {
        var resolved = new Skills.CliResolver(paths, providers, callSites).Resolve(callSiteId, "");
        return new CliResolution(resolved.AdapterKey, resolved.Binary, new Dictionary<string, string>(resolved.EnvOverrides), resolved.ProviderAssigned);
    }

    /// <summary>The argv of an agent window; a bare one gets the prompt first and the CLI's ambient context stripped (no plugin, settings, MCP or slash commands), keeping the session file so Resume works.</summary>
    private string[] Argv(string binary, bool isClaude, string adapterKey, string? resumeSessionId, string? initialPrompt, bool bare, string? visiblePrompt, McpEndpoint? mcp = null)
    {
        var bareArgs = bare && string.IsNullOrEmpty(resumeSessionId) && CliAdapters.All.TryGetValue(adapterKey, out var adapter)
            ? adapter.BareArgs(CliAdapters.DefaultBareTools).Where(a => a != "--no-session-persistence").ToArray()
            : [];
        var promptAt = Array.IndexOf(bareArgs, "--system-prompt");
        if (bareArgs.Length > 0 && visiblePrompt is not null && !string.IsNullOrEmpty(initialPrompt) && promptAt >= 0 && promptAt + 1 < bareArgs.Length)
        {
            // The long skill rides in the system prompt so the window shows only the short visible message (none when empty: the CLI waits for the user).
            bareArgs[promptAt + 1] = initialPrompt;
            return [binary, .. ResumePrompt(null, visiblePrompt), .. bareArgs];
        }
        if (bareArgs.Length > 0) return [binary, .. ResumePrompt(null, initialPrompt), .. bareArgs];
        return [binary, .. McpArgs(mcp), .. PluginArgs(isClaude), .. ResumePrompt(resumeSessionId, initialPrompt)];
    }

    /// <summary>Registers the bridge ask_user MCP server; --mcp-config is variadic, so it must precede --plugin-dir and the positional prompt.</summary>
    private string[] McpArgs(McpEndpoint? mcp) => mcp is null ? [] : ["--mcp-config", mcp.WriteClaudeConfig(questions!.AskWait)];

    /// <summary>Load CodeChroma skills for this Claude Code process without changing its project.</summary>
    private static string[] PluginArgs(bool isClaude) => isClaude && SkillSync.PluginDir() is { } dir ? ["--plugin-dir", dir] : [];

    private static string[] ResumePrompt(string? resumeSessionId, string? initialPrompt)
    {
        if (!string.IsNullOrEmpty(resumeSessionId)) return [ResumeFlag, resumeSessionId];
        return string.IsNullOrEmpty(initialPrompt) ? [] : [initialPrompt];
    }
}
