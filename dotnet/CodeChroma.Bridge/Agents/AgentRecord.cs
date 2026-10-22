using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>One row of agents.json plus the runtime fields the API reports but never persists.</summary>
public sealed class AgentRecord
{
    public const string DefaultKind = "claude";
    public const string StatusStopped = "stopped";
    public const string StatusRunning = "running";
    public const string StatusExited = "exited";
    public static readonly string[] ContextKinds = ["view", "task"];

    public required string Id { get; set; }
    public required string Title { get; set; }
    public required string Kind { get; set; }
    public required string Branch { get; set; }
    public required string Worktree { get; set; }
    public required string CreatedAt { get; set; }
    public string? SessionId { get; set; }
    public string? PrUrl { get; set; }
    public int? Pid { get; set; }
    public JsonObject Window { get; set; } = DefaultWindow();

    /// <summary>The attach_to id this agent's worktree/branch is shared with; null for its own worktree.</summary>
    public string? SharesWorkspaceWith { get; set; }

    /// <summary>Which of main's branches this agent belongs to; null for records written before the field.</summary>
    public string? BaseBranch { get; set; }

    /// <summary>The pr-N this agent was forked from, if any.</summary>
    public string? SourcePr { get; set; }

    /// <summary>The first-launch context handed to the agent once, then cleared.</summary>
    public string? Context { get; set; }

    public string ContextKind { get; set; } = "view";

    /// <summary>The diagram type (or "any") a task agent draws; such an agent starts bare, with the draw skill inlined (see BareSkill.ComposeInteractive).</summary>
    public string? DiagramType { get; set; }

    /// <summary>Binary that launched this window; empty for legacy claude records.</summary>
    public string ResolvedCli { get; set; } = "";

    public string Status { get; set; } = StatusStopped;
    public int? ExitCode { get; set; }
    public bool WorktreeLost { get; set; }

    public static JsonObject DefaultWindow() => new()
    {
        ["x"] = 120, ["y"] = 120, ["width"] = 720, ["height"] = 480, ["minimized"] = false, ["z"] = 1,
    };

    /// <summary>Only the persisted subset: status and worktree_lost are derived at startup, never stored.</summary>
    public JsonObject ToJson() => new()
    {
        ["id"] = Id, ["title"] = Title, ["kind"] = Kind, ["branch"] = Branch, ["worktree"] = Worktree, ["session_id"] = SessionId,
        ["created_at"] = CreatedAt, ["pr_url"] = PrUrl, ["window"] = Window.DeepClone(), ["pid"] = Pid,
        ["shares_workspace_with"] = SharesWorkspaceWith, ["base_branch"] = BaseBranch, ["source_pr"] = SourcePr,
        ["context"] = Context, ["context_kind"] = ContextKind, ["resolved_cli"] = ResolvedCli, ["diagram_type"] = DiagramType,
    };

    /// <summary>What GET /agents reports: the record plus its live status and worktree health.</summary>
    public JsonObject ToPayload() => new()
    {
        ["id"] = Id, ["title"] = Title, ["kind"] = Kind, ["branch"] = Branch, ["worktree"] = Worktree, ["created_at"] = CreatedAt,
        ["session_id"] = SessionId, ["pr_url"] = PrUrl, ["pid"] = Pid, ["window"] = Window.DeepClone(),
        ["shares_workspace_with"] = SharesWorkspaceWith, ["base_branch"] = BaseBranch, ["source_pr"] = SourcePr,
        ["context"] = Context, ["context_kind"] = ContextKind, ["resolved_cli"] = ResolvedCli,
        ["status"] = Status, ["exit_code"] = ExitCode, ["worktree_lost"] = WorktreeLost,
    };

    /// <summary>One record from disk, or null when the entry is missing the fields that identify it.</summary>
    public static AgentRecord? FromJson(JsonNode? raw)
    {
        if (raw is not JsonObject o) return null;
        var id = Json.Str(o["id"]);
        var title = Json.Str(o["title"]);
        var branch = Json.Str(o["branch"]);
        var worktree = Json.Str(o["worktree"]);
        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(title) || string.IsNullOrEmpty(branch) || string.IsNullOrEmpty(worktree)) return null;
        var window = DefaultWindow();
        if (o["window"] is JsonObject stored)
            foreach (var (key, value) in stored) window[key] = value?.DeepClone();
        return new AgentRecord
        {
            Id = id, Title = title, Branch = branch, Worktree = worktree,
            Kind = Json.Str(o["kind"]) ?? DefaultKind,
            CreatedAt = Json.Str(o["created_at"]) ?? "",
            SessionId = Json.Str(o["session_id"]),
            PrUrl = Json.Str(o["pr_url"]),
            Pid = o["pid"] is JsonValue pid && pid.TryGetValue<int>(out var pidValue) ? pidValue : null,
            Window = window,
            SharesWorkspaceWith = Json.Str(o["shares_workspace_with"]),
            BaseBranch = Json.Str(o["base_branch"]),
            SourcePr = Json.Str(o["source_pr"]),
            Context = CleanContext(o["context"]),
            ContextKind = CoerceContextKind(Json.Str(o["context_kind"])),
            DiagramType = Json.Str(o["diagram_type"]),
            ResolvedCli = Json.Str(o["resolved_cli"]) ?? "",
        };
    }

    public static string CoerceContextKind(string? value) => value is not null && ContextKinds.Contains(value) ? value : "view";

    /// <summary>One-line, control-character-free context, or null when nothing usable is left. A control char is a real keystroke when injected into a live PTY.</summary>
    public static string? CleanContext(JsonNode? value) => CleanContext(Json.Str(value));

    public static string? CleanContext(string? value)
    {
        if (value is null) return null;
        var spaced = new string(value.Select(c => IsControl(c) ? ' ' : c).ToArray());
        var joined = string.Join(' ', spaced.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return joined.Length == 0 ? null : joined;
    }

    private static bool IsControl(char c) => c < ' ' || (c >= '\u007f' && c <= '\u009f');
}
