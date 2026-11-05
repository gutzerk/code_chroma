using System.Security.Cryptography;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>What a working agent is doing: the tool from PreToolUse, its short argument and when the turn began.</summary>
public sealed record AgentActivity(string? Tool, string? Target, DateTimeOffset TurnStartedAt)
{
    public JsonObject ToJson() => new() { ["tool"] = Tool, ["target"] = Target, ["turn_started_at"] = AgentStatusState.Iso(TurnStartedAt) };
}

/// <summary>A PermissionRequest hook waiting for the canvas to allow or deny it.</summary>
public sealed record PendingPermission(string RequestId, string Tool, string Summary, DateTimeOffset At)
{
    public JsonObject ToJson() => new() { ["request_id"] = RequestId, ["tool"] = Tool, ["summary"] = Summary, ["at"] = AgentStatusState.Iso(At) };
}

/// <summary>Why an agent is in the error state: a non-zero exit or a failed start.</summary>
public sealed record AgentError(string Message, DateTimeOffset At)
{
    public JsonObject ToJson() => new() { ["message"] = Message, ["at"] = AgentStatusState.Iso(At) };
}

/// <summary>A copy of the live status fields, taken under the state's lock.</summary>
public sealed record AgentStatusSnapshot(string Status, DateTimeOffset Since, AgentActivity? Activity, PendingPermission? Pending);

/// <summary>What one hook report did: whether the payload changed, and for PermissionRequest the decision to wait on.</summary>
public sealed record HookOutcome(bool Changed, string? RequestId = null, Task<string?>? Decision = null);

/// <summary>One live session's status: screen verdicts until the first hook report, then hooks own working/idle and the screen may only raise blocked.</summary>
public sealed class AgentStatusState(Func<DateTimeOffset>? clock = null)
{
    public const string Done = "done";
    public const int TargetLimit = 120;

    private readonly object _gate = new();
    private readonly Func<DateTimeOffset> _clock = clock ?? (() => DateTimeOffset.UtcNow);
    private string _live = StatusDetector.Idle;
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
            _since ??= _clock();
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
            else if (visibleBlocker && !_screenBlocker && _live != StatusDetector.Blocked)
            {
                _live = StatusDetector.Blocked;
            }
            else if (!visibleBlocker && _screenBlocker && _live == StatusDetector.Blocked)
            {
                _live = StatusDetector.Working;
                _activity ??= new AgentActivity(null, null, _clock());
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
            var now = _clock();
            switch (name)
            {
                case "UserPromptSubmit":
                    ClearPending();
                    _activity = new AgentActivity(null, null, now);
                    SetLive(StatusDetector.Working);
                    break;
                case "PreToolUse":
                    ClearPending();
                    _activity = new AgentActivity(tool, Target(body["tool_input"]), _activity?.TurnStartedAt ?? now);
                    SetLive(StatusDetector.Working);
                    break;
                case "PostToolUse":
                    ClearPending();
                    _activity ??= new AgentActivity(null, null, now);
                    SetLive(StatusDetector.Working);
                    break;
                case "Notification":
                    var kind = Json.Str(body["notification_type"]) ?? "";
                    if (kind == "permission_prompt" || kind.StartsWith("elicitation", StringComparison.Ordinal)) SetLive(StatusDetector.Blocked);
                    break;
                case "PermissionRequest":
                    ClearPending();
                    var target = Target(body["tool_input"]);
                    var label = tool ?? "tool";
                    _pending = new PendingPermission("p_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(3)).ToLowerInvariant(), label,
                        target is null ? label : $"{label}({target})", now);
                    _waiter = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
                    SetLive(StatusDetector.Blocked);
                    break;
                case "Stop":
                    ClearPending();
                    SetLive(StatusDetector.Idle);
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
            _since = _clock();
        }
    }

    /// <summary>The short argument a tool call is about: file_path, command, pattern or url, single-line and at most 120 chars.</summary>
    public static string? Target(JsonNode? input)
    {
        if (input is not JsonObject args) return null;
        foreach (var key in new[] { "file_path", "command", "pattern", "url" })
        {
            if (Json.Str(args[key]) is not { Length: > 0 } raw) continue;
            var line = string.Join(' ', raw.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            return line.Length <= TargetLimit ? line : line[..(TargetLimit - 1)] + "…";
        }
        return null;
    }

    public static string Iso(DateTimeOffset moment) => moment.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture);

    private string Effective() => _live == StatusDetector.Idle && _unread ? Done : _live;

    private void SetLive(string status, bool unreadOnIdle = false)
    {
        if (unreadOnIdle && _live == StatusDetector.Working && status == StatusDetector.Idle) _unread = true;
        if (status == StatusDetector.Working) _unread = false;
        if (status == StatusDetector.Working && !_hooked) _activity ??= new AgentActivity(null, null, _clock());
        if (status == StatusDetector.Idle) _activity = null;
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
        if (before.Status != Effective() || _since is null) _since = _clock();
        return before.Status != Effective() || before.Activity != _activity || before.Pending != _pending;
    }
}
