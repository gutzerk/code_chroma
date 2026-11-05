using System.Security.Cryptography;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>Every status an agent card reports: idle/working/blocked/done while it runs, stopped or error once gone.</summary>
public static class AgentStatus
{
    public const string Stopped = "stopped";
    public const string Idle = "idle";
    public const string Working = "working";
    public const string Blocked = "blocked";
    public const string Done = "done";
    public const string Error = "error";
}

/// <summary>What a working agent is doing: the tool from PreToolUse, its short argument and when the turn began.</summary>
public sealed record AgentActivity(string? Tool, string? Target, DateTimeOffset TurnStartedAt)
{
    public JsonObject ToJson() => new() { ["tool"] = Tool, ["target"] = Target, ["turn_started_at"] = Json.Iso(TurnStartedAt) };
}

/// <summary>A PermissionRequest hook waiting for the canvas to allow or deny it.</summary>
public sealed record PendingPermission(string RequestId, string Tool, string Summary, DateTimeOffset At)
{
    public JsonObject ToJson() => new() { ["request_id"] = RequestId, ["tool"] = Tool, ["summary"] = Summary, ["at"] = Json.Iso(At) };
}

/// <summary>Why an agent is in the error state: a non-zero exit or a failed start.</summary>
public sealed record AgentError(string Message, DateTimeOffset At)
{
    public JsonObject ToJson() => new() { ["message"] = Message, ["at"] = Json.Iso(At) };
}

/// <summary>A copy of the live status fields, taken under the state's lock; Error is set only for the error status.</summary>
public sealed record AgentStatusSnapshot(string Status, DateTimeOffset Since, AgentActivity? Activity, PendingPermission? Pending, AgentError? Error = null);

/// <summary>What one hook report did: whether the payload changed, and for PermissionRequest the decision to wait on.</summary>
public sealed record HookOutcome(bool Changed, string? RequestId = null, Task<string?>? Decision = null);

/// <summary>One live session's status: screen verdicts until the first hook report, then hooks own working/idle and the screen may only raise blocked.</summary>
public sealed class AgentStatusState(TimeProvider? time = null)
{
    public const int TargetLimit = 120;

    private readonly object _gate = new();
    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private string _live = AgentStatus.Idle;
    private bool _unread;
    private bool _hooked;
    private bool _screenBlocker;
    private AgentActivity? _activity;
    private PendingPermission? _pending;
    private TaskCompletionSource<string?>? _waiter;
    private DateTimeOffset? _since;

    /// <summary>The detector-side status (idle, working or blocked) the screen rules should hold.</summary>
    public string Live
    {
        get { lock (_gate) return _live; }
    }

    /// <summary>Whether a hook has reported yet: from then on the screen no longer decides working or idle.</summary>
    public bool Hooked
    {
        get { lock (_gate) return _hooked; }
    }

    public AgentStatusSnapshot Snapshot()
    {
        lock (_gate)
        {
            _since ??= _time.GetUtcNow();
            return new AgentStatusSnapshot(Effective(), _since.Value, _activity, _pending);
        }
    }

    /// <summary>Applies one screen observation (the detector's new verdict or null) plus its visible-blocker flag; true when the payload changed.</summary>
    public bool ApplyScreen(string? verdict, bool visibleBlocker)
    {
        lock (_gate)
        {
            var before = Fingerprint();
            if (!_hooked)
            {
                if (verdict is not null && verdict != _live) SetLive(verdict, unreadOnIdle: true);
            }
            else if (visibleBlocker && !_screenBlocker && _live != AgentStatus.Blocked)
            {
                _live = AgentStatus.Blocked;
            }
            else if (!visibleBlocker && _screenBlocker && _live == AgentStatus.Blocked)
            {
                _live = AgentStatus.Working;
                _activity ??= new AgentActivity(null, null, _time.GetUtcNow());
                ClearPending();
            }
            _screenBlocker = visibleBlocker;
            return Commit(before);
        }
    }

    /// <summary>Maps one Claude Code hook report onto the status; unknown events change nothing.</summary>
    public HookOutcome ApplyHook(JsonObject body)
    {
        var name = Json.Str(body["hook_event_name"]) ?? "";
        var tool = Json.Str(body["tool_name"]);
        lock (_gate)
        {
            var before = Fingerprint();
            var now = _time.GetUtcNow();
            switch (name)
            {
                case "UserPromptSubmit":
                    ClearPending();
                    _activity = new AgentActivity(null, null, now);
                    SetLive(AgentStatus.Working);
                    break;
                case "PreToolUse":
                    ClearPending();
                    _activity = new AgentActivity(tool, Target(body["tool_input"]), _activity?.TurnStartedAt ?? now);
                    SetLive(AgentStatus.Working);
                    break;
                case "PostToolUse":
                    ClearPending();
                    _activity ??= new AgentActivity(null, null, now);
                    SetLive(AgentStatus.Working);
                    break;
                case "Notification":
                    var kind = Json.Str(body["notification_type"]) ?? "";
                    if (kind == "permission_prompt" || kind.StartsWith("elicitation", StringComparison.Ordinal)) SetLive(AgentStatus.Blocked);
                    break;
                case "PermissionRequest":
                    ClearPending();
                    var target = Target(body["tool_input"]);
                    var label = tool ?? "tool";
                    _pending = new PendingPermission("p_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(3)).ToLowerInvariant(), label,
                        target is null ? label : $"{label}({target})", now);
                    _waiter = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
                    SetLive(AgentStatus.Blocked);
                    break;
                case "Stop":
                    ClearPending();
                    SetLive(AgentStatus.Idle);
                    _unread = true;
                    break;
                default:
                    return new HookOutcome(false);
            }
            _hooked = true;
            var changed = Commit(before);
            return name == "PermissionRequest" ? new HookOutcome(changed, _pending!.RequestId, _waiter!.Task) : new HookOutcome(changed);
        }
    }

    /// <summary>Done becomes idle once the user looked at the agent; true when that changed anything.</summary>
    public bool MarkSeen()
    {
        lock (_gate)
        {
            var before = Fingerprint();
            _unread = false;
            return Commit(before);
        }
    }

    /// <summary>Hands the canvas's decision to the waiting hook; false when no such request is pending.</summary>
    public bool Decide(string requestId, string decision)
    {
        lock (_gate)
        {
            if (_pending?.RequestId != requestId) return false;
            _waiter?.TrySetResult(decision);
            _waiter = null;
            _pending = null;
            return true;
        }
    }

    /// <summary>Drops a request nobody answered in time (the terminal dialog takes over); true when it was still pending.</summary>
    public bool Expire(string requestId)
    {
        lock (_gate)
        {
            if (_pending?.RequestId != requestId) return false;
            ClearPending();
            return true;
        }
    }

    /// <summary>The process ended: any waiting hook gets no decision and the status clock restarts.</summary>
    public void Exit()
    {
        lock (_gate)
        {
            ClearPending();
            _activity = null;
            _since = _time.GetUtcNow();
        }
    }

    /// <summary>The tool_input keys a target is read from, in order; the agent-hook forwards only these.</summary>
    public static readonly string[] TargetKeys = ["file_path", "command", "pattern", "url"];

    /// <summary>The short argument a tool call is about: file_path, command, pattern or url, single-line and at most 120 chars.</summary>
    public static string? Target(JsonNode? input)
    {
        if (input is not JsonObject args) return null;
        foreach (var key in TargetKeys)
            if (Json.Str(args[key]) is { Length: > 0 } raw) return SkillOutput.Flatten(raw, TargetLimit);
        return null;
    }

    private string Effective() => _live == AgentStatus.Idle && _unread ? AgentStatus.Done : _live;

    private void SetLive(string status, bool unreadOnIdle = false)
    {
        if (unreadOnIdle && _live == AgentStatus.Working && status == AgentStatus.Idle) _unread = true;
        if (status == AgentStatus.Working) _unread = false;
        if (status == AgentStatus.Working && !_hooked) _activity ??= new AgentActivity(null, null, _time.GetUtcNow());
        if (status == AgentStatus.Idle) _activity = null;
        _live = status;
    }

    private void ClearPending()
    {
        _waiter?.TrySetResult(null);
        _waiter = null;
        _pending = null;
    }

    private (string, AgentActivity?, PendingPermission?) Fingerprint() => (Effective(), _activity, _pending);

    private bool Commit((string Status, AgentActivity? Activity, PendingPermission? Pending) before)
    {
        if (before.Status != Effective() || _since is null) _since = _time.GetUtcNow();
        return before.Status != Effective() || before.Activity != _activity || before.Pending != _pending;
    }
}
