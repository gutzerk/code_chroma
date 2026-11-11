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
public sealed record AgentLaunch(IReadOnlyList<string> Argv, IReadOnlyDictionary<string, string> Env)
{
    /// <summary>The status manifest to detect this window with; an `agent` window uses the CLI adapter it resolved to (detect/claude.toml for Claude), except behind a stand-in binary.</summary>
    public string? DetectorKind { get; init; }

    /// <summary>How the window notices the user cleared the CLI's conversation (the resolved adapter's definition); null for a shell or a stand-in binary.</summary>
    public ClearWatch? Clear { get; init; }
    /// <summary>Whether `--settings` carrying the status hooks was emitted, so the bridge hears this CLI's prompts and clears.</summary>
    public bool StatusHooks { get; init; }
    /// <summary>How the window gets its launch context: hidden with the first prompt, typed once idle, or not at all (a shell).</summary>
    public PromptContext PromptContext { get; init; }
}

/// <summary>How an agent window receives its launch context.</summary>
public enum PromptContext
{
    /// <summary>Not delivered (a shell).</summary>
    None,
    /// <summary>The status hook hands it to the user's first prompt.</summary>
    Hidden,
    /// <summary>Typed as a `[Context]` turn once the CLI idles: a CLI agent without the hidden hook.</summary>
    Typed,
}

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

    /// <summary>An allow-listed agent's argv and provider environment, or null for an unknown kind; `forkSession` (claude only) resumes into a new session; `workdir` is where the window runs; `delegation` (claude only) adds a drawing window's drawer subagent and lead instruction.</summary>
    public AgentLaunch? Resolve(string agent, string? resumeSessionId = null, string? initialPrompt = null, bool bare = false, string? visiblePrompt = null, bool forkSession = false, string? agentId = null, string? bridgeUrl = null, string? newSessionId = null, string? sessionTrackingFile = null, string? workdir = null, DrawDelegation? delegation = null)
    {
        if (agent == "agent")
        {
            var resolution = ResolveProviderCli(AgentCallSite);
            var isClaude = IsRealClaude(resolution);
            // The claude adapter behind a stand-in binary is not the real CLI, so it gets no MCP server.
            var standIn = resolution.AdapterKey == "claude" && !isClaude;
            var adapter = standIn ? null : CliAdapters.All.GetValueOrDefault(resolution.AdapterKey);
            var mcp = McpFor(adapter, agentId, bridgeUrl, bare, workdir);
            var argv = Argv(resolution.Binary, isClaude, resolution.AdapterKey, resumeSessionId, initialPrompt, bare, visiblePrompt, mcp?.Args, ModelArgs(resolution), delegation);
            var hooks = isClaude ? HookEndpointFor(agentId, bridgeUrl) : null;
            var launch = OwnedLaunch(argv, WithEnv(resolution.Env, mcp), isClaude, resumeSessionId, forkSession, newSessionId, sessionTrackingFile, mcp is not null, hooks);
            return launch with { DetectorKind = standIn ? null : resolution.AdapterKey, Clear = ClearWatch.For(adapter, launch.StatusHooks) };
        }
        if (!Allowed.TryGetValue(agent, out var entry)) return null;
        if (agent == "claude")
        {
            var binary = AssistantRoutes.EffectiveCli(paths);
            var mcp = McpFor(binary == DefaultCli ? CliAdapters.All["claude"] : null, agentId, bridgeUrl, bare, workdir);
            var argv = Argv(binary, binary == DefaultCli, "claude", resumeSessionId, initialPrompt, bare, visiblePrompt, mcp?.Args, delegation: delegation);
            var hooks = binary == DefaultCli ? HookEndpointFor(agentId, bridgeUrl) : null;
            var launch = OwnedLaunch(argv, WithEnv([], mcp), binary == DefaultCli, resumeSessionId, forkSession, newSessionId, sessionTrackingFile, mcp is not null, hooks);
            return launch with { Clear = ClearWatch.For(binary == DefaultCli ? CliAdapters.All["claude"] : null, launch.StatusHooks) };
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

    /// <summary>Whether a window of this kind launches the real claude CLI, so a drawing window can run as a normal agent with the drawer subagent.</summary>
    public bool Delegates(string kind) => kind switch
    {
        "claude" => AssistantRoutes.EffectiveCli(paths) == DefaultCli,
        "agent" => IsRealClaude(ResolveProviderCli(AgentCallSite)),
        _ => false,
    };

    /// <summary>Whether a provider-routed window runs the real claude CLI, not another adapter or a stand-in binary.</summary>
    private static bool IsRealClaude(CliResolution cli) => cli.AdapterKey == "claude" && (cli.ProviderAssigned || cli.Binary == DefaultCli);

    /// <summary>The ask_user registration with the endpoint env merged in, or null for a CLI with no MCP route, bare windows, no agent id or before the bridge URL is known.</summary>
    private McpLaunch? McpFor(ICliAdapter? adapter, string? agentId, string? bridgeUrl, bool bare, string? workdir)
    {
        if (questions is null || adapter is null || bare || string.IsNullOrEmpty(agentId) || string.IsNullOrEmpty(bridgeUrl)) return null;
        var endpoint = questions.EndpointFor(agentId, bridgeUrl);
        if (adapter.Mcp(endpoint, workdir) is not { } launch) return null;
        var env = endpoint.Env();
        foreach (var (key, value) in launch.Env ?? new Dictionary<string, string>()) env[key] = value;
        return launch with { Env = env };
    }

    /// <summary>The endpoint whose token the status hooks post with, or null without the question server, an agent id or the bridge URL.</summary>
    private McpEndpoint? HookEndpointFor(string? agentId, string? bridgeUrl) =>
        questions is null || string.IsNullOrEmpty(agentId) || string.IsNullOrEmpty(bridgeUrl) ? null : questions.EndpointFor(agentId, bridgeUrl);

    /// <summary>Forces claude's classic renderer over a user's `"tui": "fullscreen"` setting.</summary>
    public const string ClassicRendererEnv = "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN";

    private static Dictionary<string, string> WithEnv(Dictionary<string, string> env, McpLaunch? mcp)
    {
        if (mcp?.Env is null) return env;
        var merged = new Dictionary<string, string>(env);
        foreach (var (key, value) in mcp.Env) merged[key] = value;
        return merged;
    }

    private static AgentLaunch OwnedLaunch(string[] argv, IReadOnlyDictionary<string, string> env, bool isClaude, string? resumeSessionId, bool fork, string? newSessionId, string? trackingFile, bool hasMcp, McpEndpoint? hooks = null)
    {
        if (!isClaude) return new AgentLaunch(argv, env) { PromptContext = PromptContext.Typed };
        var options = new List<string>();
        if (fork && !string.IsNullOrEmpty(resumeSessionId)) options.Add(ForkSessionFlag);
        var fresh = string.IsNullOrEmpty(resumeSessionId) || fork;
        if (fresh && !string.IsNullOrEmpty(newSessionId)) options.AddRange(["--session-id", newSessionId]);
        var ownedEnv = new Dictionary<string, string>(env);
        var settings = trackingFile is not null || hasMcp || hooks is not null ? AgentSessionOwnership.TryHookSettings(trackingFile is not null, hasMcp, hooks is not null) : null;
        if (settings is not null) options.AddRange(["--settings", settings]);
        var statusHooks = hooks is not null && AgentSessionOwnership.CanRunHooks;
        // The status hooks authenticate with the agent's workspace token, which a bare window gets without the MCP server.
        foreach (var (key, value) in hooks?.Env() ?? new Dictionary<string, string>()) ownedEnv.TryAdd(key, value);
        // A fullscreen (alternate-screen) TUI leaves xterm no scrollback, so the window's scrollbar has nothing to scroll.
        ownedEnv[ClassicRendererEnv] = "1";
        if (trackingFile is not null)
        {
            ownedEnv[AgentSessionOwnership.FileEnv] = trackingFile;
            ownedEnv[AgentSessionOwnership.InitialIdEnv] = (fresh ? newSessionId : resumeSessionId) ?? "";
        }
        // Options precede the prompt and the variadic --plugin-dir / --allowedTools options.
        var context = statusHooks && CliAdapters.All["claude"].HiddenPromptContext ? PromptContext.Hidden : PromptContext.Typed;
        return new AgentLaunch([argv[0], .. options, .. argv.Skip(1)], ownedEnv) { StatusHooks = statusHooks, PromptContext = context };
    }

    /// <summary>The label persisted on AgentRecord.ResolvedCli: only `agent` windows report one.</summary>
    public static string ResolvedCliFor(string kind, IReadOnlyList<string> argv) => kind == "agent" ? argv[0] : "";

    private sealed record CliResolution(string AdapterKey, string Binary, string Model, Dictionary<string, string> Env, bool ProviderAssigned);

    /// <summary>`--model` for the chosen model; omitted when none is set or ANTHROPIC_MODEL already carries it.</summary>
    private static string[] ModelArgs(CliResolution cli) =>
        cli.Model.Length == 0 || cli.Env.ContainsKey("ANTHROPIC_MODEL") ? [] : ["--model", cli.Model];

    /// <summary>The shared CliResolver, as the Python agent window shares resolve_cli: overrides, the default, and anthropic API providers.</summary>
    private CliResolution ResolveProviderCli(string callSiteId)
    {
        var resolved = new Skills.CliResolver(paths, providers, callSites).Resolve(callSiteId, "");
        return new CliResolution(resolved.AdapterKey, resolved.Binary, resolved.Model, new Dictionary<string, string>(resolved.EnvOverrides), resolved.ProviderAssigned);
    }

    /// <summary>The argv of an agent window; a bare one gets the prompt first and the CLI's ambient context stripped (no plugin, settings, MCP or slash commands), keeping the session file so Resume works.</summary>
    private string[] Argv(string binary, bool isClaude, string adapterKey, string? resumeSessionId, string? initialPrompt, bool bare, string? visiblePrompt, IReadOnlyList<string>? mcpArgs = null, string[]? modelArgs = null, DrawDelegation? delegation = null)
    {
        var bareArgs = bare && string.IsNullOrEmpty(resumeSessionId) && CliAdapters.All.TryGetValue(adapterKey, out var adapter)
            ? adapter.BareArgs(CliAdapters.DefaultBareTools).Where(a => a != "--no-session-persistence").ToArray()
            : [];
        var model = modelArgs ?? [];
        var promptAt = Array.IndexOf(bareArgs, "--system-prompt");
        if (bareArgs.Length > 0 && visiblePrompt is not null && !string.IsNullOrEmpty(initialPrompt) && promptAt >= 0 && promptAt + 1 < bareArgs.Length)
        {
            // The long skill rides in the system prompt so the window shows only the short visible message (none when empty: the CLI waits for the user).
            bareArgs[promptAt + 1] = initialPrompt;
            return [binary, .. model, .. ResumePrompt(null, visiblePrompt), .. bareArgs];
        }
        if (bareArgs.Length > 0) return [binary, .. model, .. ResumePrompt(null, initialPrompt), .. bareArgs];
        // Only a real claude launch takes a delegation (the CLI may have changed since a widen-resume stored one); the start block rides on the first launch only.
        var drawer = delegation is not null && isClaude && CliAdapters.All.TryGetValue(adapterKey, out var cli)
            ? cli.SubagentArgs(BareSkill.DrawerPlugin, BareSkill.DrawerAgent, BareSkill.DrawerDescription, delegation.DrawerPrompt, CliAdapters.DefaultBareTools, delegation.AllowedTools)
            : [];
        var lead = delegation is null ? null : string.IsNullOrEmpty(resumeSessionId) ? $"{delegation.Lead}\n{delegation.Start}" : delegation.Lead;
        return [binary, .. model, .. InstructionArgs(isClaude, lead), .. drawer, .. mcpArgs ?? [], .. PluginArgs(isClaude), .. ResumePrompt(resumeSessionId, initialPrompt)];
    }

    /// <summary>Appends the user's saved agent-window instruction, then a drawing window's lead instruction, to claude's system prompt; empty when neither is set.</summary>
    private string[] InstructionArgs(bool isClaude, string? lead = null)
    {
        if (!isClaude) return [];
        var text = string.Join("\n\n", new[] { Json.Str(AssistantRoutes.Load(paths)["instruction"])?.Trim(), lead?.Trim() }.Where(part => !string.IsNullOrEmpty(part)));
        return text.Length > 0 ? ["--append-system-prompt", text] : [];
    }

    /// <summary>Load CodeChroma skills for this Claude Code process without changing its project.</summary>
    private static string[] PluginArgs(bool isClaude) => isClaude && SkillSync.PluginDir() is { } dir ? ["--plugin-dir", dir] : [];

    private static string[] ResumePrompt(string? resumeSessionId, string? initialPrompt)
    {
        if (!string.IsNullOrEmpty(resumeSessionId)) return [ResumeFlag, resumeSessionId];
        return string.IsNullOrEmpty(initialPrompt) ? [] : [initialPrompt];
    }
}
