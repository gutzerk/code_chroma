namespace CodeChroma.Canvas.Agents;

public sealed record WindowGeometry(double X, double Y, double Width, double Height, bool Minimized, int Z);

/// <summary>One parallel agent (GET /agents): its own branch and worktree, its window, and what the LED shows.</summary>
public sealed record AgentRecord(
    string Id,
    string Title,
    string Status,
    WindowGeometry Window,
    string Branch = "",
    string? BaseBranch = null,
    string? SourcePr = null,
    string? SharesWorkspaceWith = null);

/// <summary>The agent endpoints the window layer needs; the real client is the bridge, tests use a fake.</summary>
public interface IAgentClient
{
    /// <summary>Creates and starts a new agent attached to the active workspace; throws when the limit is reached.</summary>
    Task<AgentRecord> CreateAsync(string activeWorkspace);
    Task DeleteAsync(string id);
    Task SaveWindowAsync(string id, WindowGeometry geometry);
    Task ActivateWorkspaceAsync(string id);
}

public static class AgentStatusLabels
{
    public static string Of(string status) => status switch
    {
        "stopped" => "Stopped",
        "running" => "Running",
        "exited" => "Crashed",
        "idle" => "Idle",
        "blocked" => "Blocked",
        "working" => "Working",
        "foreign" => "Running something else",
        _ => status,
    };
}

/// <summary>One row of the agent rail: the entry persists for the agent's whole lifetime, restoring flips Pressed.</summary>
public sealed record AgentRailEntry(string Id, string Title, string StatusText, string Status, bool Pressed, bool OffBranch);

/// <summary>
/// The agent list and window layout (port of agentStore.ts, windowActions.ts, branchScope.ts and the rail's rules): launch
/// refuses past the limit, a window is clamped so its title bar stays reachable, minimize and restore keep the agent (and its
/// terminal) alive, closing needs no confirmation, and an agent whose base branch is not the one main has checked out is dimmed
/// and labelled "on &lt;branch&gt;" rather than hidden or torn down.
/// </summary>
public sealed class AgentWindowStore
{
    public const int MaxAgents = 5;
    public const double MinVisible = 120;
    public static readonly string LimitLabel = $"{MaxAgents} agents is the limit — close one to start another";

    private readonly IAgentClient _client;
    private List<AgentRecord> _agents = new();

    public AgentWindowStore(IAgentClient client, double viewportWidth = 1280, double viewportHeight = 800)
    {
        _client = client;
        ViewportWidth = viewportWidth;
        ViewportHeight = viewportHeight;
    }

    public event Action? Changed;

    public IReadOnlyList<AgentRecord> Agents => _agents;
    public double ViewportWidth { get; private set; }
    public double ViewportHeight { get; private set; }
    public string ActiveWorkspace { get; private set; } = "main";
    public string? CurrentBranch { get; private set; }
    public bool IsLaunching { get; private set; }
    public string? LaunchError { get; private set; }

    public bool IsAtCapacity => _agents.Count >= MaxAgents;

    /// <summary>The Run agent button is disabled at the limit (or mid-launch) and explains why.</summary>
    public bool CanRun => !IsAtCapacity && !IsLaunching;
    public string? RunDisabledReason => IsAtCapacity ? LimitLabel : null;

    public AgentRecord? Get(string id) => _agents.FirstOrDefault(a => a.Id == id);

    public void SetBranch(string? current)
    {
        CurrentBranch = current;
        Changed?.Invoke();
    }

    /// <summary>Does this agent belong to the branch main has checked out? Unknown on either side stays in scope.</summary>
    public bool IsOnBranch(AgentRecord agent) => agent.BaseBranch is null || CurrentBranch is null || agent.BaseBranch == CurrentBranch;

    /// <summary>Visible windows: not minimized. A branch change never hides one (the agent lives in its own worktree).</summary>
    public IEnumerable<AgentRecord> VisibleWindows => _agents.Where(a => !a.Window.Minimized);

    /// <summary>Every agent is a rail entry for its whole lifetime, in launch order.</summary>
    public IReadOnlyList<AgentRailEntry> Rail => _agents.Select(a =>
    {
        var onBranch = IsOnBranch(a);
        return new AgentRailEntry(a.Id, a.Title, onBranch ? AgentStatusLabels.Of(a.Status) : $"on {a.BaseBranch}", a.Status, !a.Window.Minimized, !onBranch);
    }).ToList();

    public void SetViewport(double width, double height)
    {
        ViewportWidth = width;
        ViewportHeight = height;
        _agents = _agents.Select(Clamp).ToList();
        Changed?.Invoke();
    }

    /// <summary>"Run agent": creates and starts an agent attached to the active workspace at once; a double click cannot slip past the limit.</summary>
    public async Task<AgentRecord?> LaunchAsync()
    {
        if (!CanRun) return null;
        IsLaunching = true;
        LaunchError = null;
        Changed?.Invoke();
        try
        {
            var created = Clamp(await _client.CreateAsync(ActiveWorkspace));
            _agents = _agents.Where(a => a.Id != created.Id).Append(created).ToList();
            return created;
        }
        catch (Exception ex)
        {
            LaunchError = ex.Message;
            return null;
        }
        finally
        {
            IsLaunching = false;
            Changed?.Invoke();
        }
    }

    /// <summary>Closing takes the window away at once, with no confirmation.</summary>
    public async Task CloseAsync(string id)
    {
        _agents = _agents.Where(a => a.Id != id).ToList();
        if (ActiveWorkspace == id) ActiveWorkspace = "main";
        Changed?.Invoke();
        try { await _client.DeleteAsync(id); }
        catch (Exception ex) { LaunchError = ex.Message; Changed?.Invoke(); }
    }

    /// <summary>Moves a window by a screen-space delta (windows live in screen coordinates, never canvas zoom) and keeps its title bar reachable.</summary>
    public void Move(string id, double dx, double dy)
    {
        if (Get(id) is not { } a) return;
        Set(id, a.Window with { X = a.Window.X + dx, Y = a.Window.Y + dy });
    }

    /// <summary>Persists the geometry once the drag ends; the bridge is only told on release.</summary>
    public async Task CommitWindowAsync(string id)
    {
        if (Get(id) is not { } a) return;
        try { await _client.SaveWindowAsync(id, a.Window); }
        catch (Exception) { /* a geometry save is cosmetic; a failed one never interrupts the session */ }
    }

    public int BringToFront(string id)
    {
        var next = (_agents.Count == 0 ? 0 : _agents.Max(a => a.Window.Z)) + 1;
        if (Get(id) is { } a) Set(id, a.Window with { Z = next });
        return next;
    }

    public async Task MinimizeAsync(string id)
    {
        if (Get(id) is not { } a) return;
        Set(id, a.Window with { Minimized = true });
        await CommitWindowAsync(id);
    }

    /// <summary>Restores and raises in one step; also follows the agent's workspace unless the canvas already shows its data.</summary>
    public async Task RestoreAsync(string id)
    {
        if (Get(id) is not { } a) return;
        var z = BringToFront(id);
        Set(id, a.Window with { Minimized = false, Z = z });
        await CommitWindowAsync(id);
        if (!ShouldActivateWorkspace(a)) return;
        ActiveWorkspace = id;
        Changed?.Invoke();
        try { await _client.ActivateWorkspaceAsync(id); }
        catch (Exception ex) { LaunchError = ex.Message; Changed?.Invoke(); }
    }

    /// <summary>The rail click: a visible window minimizes, a minimized one restores.</summary>
    public Task ToggleFromRailAsync(string id) => Get(id)?.Window.Minimized == true ? RestoreAsync(id) : MinimizeAsync(id);

    private bool ShouldActivateWorkspace(AgentRecord agent) =>
        ActiveWorkspace != agent.Id && agent.SharesWorkspaceWith != ActiveWorkspace && agent.SourcePr != ActiveWorkspace;

    private void Set(string id, WindowGeometry geometry)
    {
        _agents = _agents.Select(a => a.Id == id ? Clamp(a with { Window = geometry }) : a).ToList();
        Changed?.Invoke();
    }

    private AgentRecord Clamp(AgentRecord a)
    {
        var w = Math.Min(a.Window.Width, Math.Max(ViewportWidth, MinVisible));
        var h = Math.Min(a.Window.Height, Math.Max(ViewportHeight, MinVisible));
        var x = Math.Clamp(a.Window.X, 0, Math.Max(ViewportWidth - MinVisible, 0));
        var y = Math.Clamp(a.Window.Y, 0, Math.Max(ViewportHeight - MinVisible, 0));
        return a.Window.X == x && a.Window.Y == y && a.Window.Width == w && a.Window.Height == h ? a : a with { Window = a.Window with { X = x, Y = y, Width = w, Height = h } };
    }
}
