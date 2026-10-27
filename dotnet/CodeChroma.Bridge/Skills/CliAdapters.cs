using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Skills;

/// <summary>One argv-building / output-parsing implementation per CLI tool, always run unattended with JSONL output.</summary>
public interface ICliAdapter
{
    /// <summary>`extra` is placed where the CLI accepts options (before a trailing positional prompt).</summary>
    IReadOnlyList<string> BuildArgv(string binary, string prompt, string model, IReadOnlyDictionary<string, string>? env, IReadOnlyList<string>? extra = null);

    IReadOnlyList<string> ParseLine(string raw, string repoRoot);

    /// <summary>Extra options that strip the CLI's ambient context (skills, MCP, settings) for a bare run limited to <paramref name="tools"/>; empty when the CLI has no verified switch.</summary>
    IReadOnlyList<string> BareArgs(string tools) => [];

    /// <summary>Whether the CLI can resume (and fork) an earlier session by id.</summary>
    bool CanResume => false;

    /// <summary>The options that resume <paramref name="session"/>, forked into a new session when <paramref name="fork"/>; empty when the CLI cannot resume.</summary>
    IReadOnlyList<string> ResumeArgs(string session, bool fork) => [];
}

public static class CliAdapters
{
    public const string DefaultBareTools = "Bash,Read,Write,Edit,Glob,Grep";

    public static IReadOnlyDictionary<string, ICliAdapter> All { get; } = new Dictionary<string, ICliAdapter>
    {
        ["claude"] = new ClaudeAdapter(),
        ["codex"] = new CodexAdapter(),
        ["kimi-cli"] = new KimiAdapter(),
        ["gemini"] = new GeminiAdapter(),
    };

    /// <summary>Whether the adapter named <paramref name="adapterKey"/> can resume a session; false for an unknown or missing adapter.</summary>
    public static bool CanResume(string? adapterKey) => adapterKey is not null && All.TryGetValue(adapterKey, out var adapter) && adapter.CanResume;

    /// <summary>The resume options of the adapter named <paramref name="adapterKey"/>, empty when it cannot resume.</summary>
    public static IReadOnlyList<string> ResumeArgs(string adapterKey, string session, bool fork) =>
        All.TryGetValue(adapterKey, out var adapter) ? adapter.ResumeArgs(session, fork) : [];

    internal static JsonObject? ParseEvent(string raw)
    {
        try
        {
            return JsonNode.Parse(raw) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>`claude -p ... --output-format stream-json`.</summary>
public sealed class ClaudeAdapter : ICliAdapter
{
    public const string ResumeFlag = "--resume";
    public const string ForkSessionFlag = "--fork-session";

    public bool CanResume => true;

    public IReadOnlyList<string> ResumeArgs(string session, bool fork) => fork ? [ResumeFlag, session, ForkSessionFlag] : [ResumeFlag, session];

    public IReadOnlyList<string> BuildArgv(string binary, string prompt, string model, IReadOnlyDictionary<string, string>? env, IReadOnlyList<string>? extra = null)
    {
        var argv = new List<string> { binary, "-p", prompt };
        if (model.Length > 0) argv.AddRange(["--model", model]);
        argv.AddRange(["--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose"]);
        var key = env is not null ? env.GetValueOrDefault("ANTHROPIC_API_KEY") : Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
        if (!string.IsNullOrEmpty(key)) argv.Add("--bare");
        argv.AddRange(extra ?? []);
        return argv;
    }

    public IReadOnlyList<string> ParseLine(string raw, string repoRoot) =>
        CliAdapters.ParseEvent(raw) is { } evt ? SkillOutput.Render(evt, repoRoot) : [];

    /// <summary>Works with OAuth logins, unlike `--bare` (which needs an API key): no slash commands, MCP, user/project settings or session file.</summary>
    public IReadOnlyList<string> BareArgs(string tools) =>
    [
        "--tools", tools, "--allowedTools", .. tools.Split(','), "--disable-slash-commands", "--strict-mcp-config",
        "--setting-sources", "local", "--no-session-persistence",
        "--system-prompt", "Follow the instructions in the user message exactly.",
    ];

    /// <summary>A zero-tool, single-shot call for a wiki-general pipeline worker.</summary>
    public IReadOnlyList<string> BuildWorkerArgv(string binary, string prompt, string model, string schemaJson)
    {
        var argv = new List<string> { binary, "-p", prompt };
        if (model.Length > 0) argv.AddRange(["--model", model]);
        argv.AddRange(["--output-format", "json", "--json-schema", schemaJson, "--safe-mode", "--strict-mcp-config", "--tools", ""]);
        return argv;
    }

    /// <summary>A worker's JSON envelope: `structured_output` if present, else the parsed `result`.</summary>
    public JsonObject? ParseStructuredOutput(string raw)
    {
        var envelope = CliAdapters.ParseEvent(raw);
        if (envelope is null || Json.Truthy(envelope["is_error"])) return null;
        if (envelope["structured_output"] is JsonObject structured) return structured.DeepClone().AsObject();
        if (Json.Str(envelope["result"]) is not { } result) return null;
        return CliAdapters.ParseEvent(result);
    }

    public string? ParseErrorMessage(string raw) =>
        CliAdapters.ParseEvent(raw) is { } envelope && Json.Str(envelope["result"]) is { } result && !Json.IsBlank(result) ? result : null;
}

/// <summary>`codex exec --json`.</summary>
public sealed class CodexAdapter : ICliAdapter
{
    private const int MaxMessage = 200;
    private static readonly string[] ToolTypes = ["command_execution", "file_change", "mcp_tool_call", "web_search", "plan_update"];

    public IReadOnlyList<string> BuildArgv(string binary, string prompt, string model, IReadOnlyDictionary<string, string>? env, IReadOnlyList<string>? extra = null) =>
        [binary, "exec", "--model", model, "--sandbox", "workspace-write", "--json", .. extra ?? [], prompt];

    public IReadOnlyList<string> ParseLine(string raw, string repoRoot)
    {
        if (CliAdapters.ParseEvent(raw) is not { } evt) return [];
        switch (Json.Str(evt["type"]))
        {
            case "item.completed":
                return RenderItem(evt["item"] as JsonObject);
            case "turn.completed":
                return ["✓ done"];
            case "turn.failed" or "error":
                var message = Json.Truthy(evt["message"]) ? evt["message"] : Json.Truthy(evt["error"]) ? evt["error"] : null;
                return [$"✗ {SkillOutput.Flatten(message is null ? "failed" : Json.Str(message) ?? message.ToJsonString(), MaxMessage)}"];
            default:
                return [];
        }
    }

    private static IReadOnlyList<string> RenderItem(JsonObject? item)
    {
        if (item is null) return [];
        var type = Json.Str(item["type"]);
        switch (type)
        {
            case "agent_message":
                return SkillOutput.TextLines(item["text"]);
            case "reasoning":
                return Json.Str(item["text"]) is { } text && !Json.IsBlank(text) ? [SkillOutput.Flatten(text, MaxMessage)] : [];
            case "error":
                return Json.Str(item["message"]) is { } message ? [$"  ↳ error: {SkillOutput.Flatten(message, MaxMessage)}"] : [];
            default:
                return type is not null && ToolTypes.Contains(type) ? [$"⏺ {type}"] : [];
        }
    }
}

/// <summary>`kimi --prompt ... --output-format stream-json`.</summary>
public sealed class KimiAdapter : ICliAdapter
{
    private const int MaxMessage = 200;

    public IReadOnlyList<string> BuildArgv(string binary, string prompt, string model, IReadOnlyDictionary<string, string>? env, IReadOnlyList<string>? extra = null) =>
        [binary, "--prompt", prompt, "--model", model, "--output-format", "stream-json", .. extra ?? []];

    public IReadOnlyList<string> ParseLine(string raw, string repoRoot)
    {
        if (CliAdapters.ParseEvent(raw) is not { } evt) return [];
        var role = Json.Str(evt["role"]);
        if (role == "assistant") return RenderAssistant(evt);
        if (role == "tool" && Json.Truthy(evt["is_error"]))
        {
            var content = Json.Truthy(evt["content"]) ? Json.Str(evt["content"]) ?? evt["content"]!.ToJsonString() : "failed";
            return [$"  ↳ error: {SkillOutput.Flatten(content, MaxMessage)}"];
        }
        return [];
    }

    private static IReadOnlyList<string> RenderAssistant(JsonObject evt)
    {
        var lines = SkillOutput.TextLines(evt["content"]);
        if (evt["tool_calls"] is JsonArray calls)
            foreach (var call in calls.OfType<JsonObject>())
            {
                var function = call["function"] as JsonObject;
                var name = Json.Str(function?["name"]) is { Length: > 0 } f ? f : Json.Str(call["name"]) is { Length: > 0 } n ? n : "tool";
                lines.Add($"⏺ {name}");
            }
        return lines;
    }
}

/// <summary>`gemini --prompt ... --yolo --output-format stream-json`; --yolo auto-approves tool calls.</summary>
public sealed class GeminiAdapter : ICliAdapter
{
    private const int MaxMessage = 200;

    public IReadOnlyList<string> BuildArgv(string binary, string prompt, string model, IReadOnlyDictionary<string, string>? env, IReadOnlyList<string>? extra = null) =>
        [binary, "--prompt", prompt, "--model", model, "--yolo", "--output-format", "stream-json", .. extra ?? []];

    public IReadOnlyList<string> ParseLine(string raw, string repoRoot)
    {
        if (CliAdapters.ParseEvent(raw) is not { } evt) return [];
        switch (Json.Str(evt["type"]))
        {
            case "message" when Json.Str(evt["role"]) == "assistant":
                return SkillOutput.TextLines(evt["content"]);
            case "tool_use":
                return [$"⏺ {(Json.Str(evt["tool_name"]) is { Length: > 0 } name ? name : "tool")}"];
            case "tool_result" when Json.Str(evt["status"]) == "error":
                var error = evt["error"];
                var message = Json.Str(error is JsonObject o ? o["message"] : error);
                return [$"  ↳ error: {SkillOutput.Flatten(string.IsNullOrEmpty(message) ? "failed" : message, MaxMessage)}"];
            case "error":
                return [$"✗ {SkillOutput.Flatten(Json.Str(evt["message"]) is { Length: > 0 } m ? m : "failed", MaxMessage)}"];
            case "result":
                return [Json.Str(evt["status"]) == "error" ? "✗ failed" : "✓ done"];
            default:
                return [];
        }
    }
}
