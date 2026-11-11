using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Agents;

/// <summary>
/// Claude's classic renderer prints history as hard rows at the width it had then and never reprints it, so after a window grows
/// noticeably wider an idle claude agent is restarted in place with `--resume` of its own session at the new size; the scrollback
/// is cleared first and the resumed process reprints the whole conversation at the new width.
/// </summary>
public sealed class WidenResume(AgentManager agents, AgentSessionRegistry sessions, TerminalAgents terminalAgents, UserPaths paths, Func<string, bool> asksUser, string? projectsRoot = null)
{
    /// <summary>How many columns wider than the narrowest printed width the window must be; smaller jitters reprint nothing.</summary>
    public const int MinGainCols = 8;

    /// <summary>The quiet time after the last resize, so dragging a window edge restarts at most once.</summary>
    public static readonly TimeSpan Settle = TimeSpan.FromSeconds(1.5);

    /// <summary>The quiet time after the last keystroke, so a restart never lands mid-typing.</summary>
    public static readonly TimeSpan TypingQuiet = TimeSpan.FromSeconds(3);

    /// <summary>How long an agent with an open ask_user question waits before it is checked again.</summary>
    public static readonly TimeSpan QuestionRetry = TimeSpan.FromSeconds(5);

    /// <summary>Resumes every due agent; returns the ids that restarted.</summary>
    public List<string> Sweep(DateTimeOffset now) =>
        sessions.All().Where(s => s.WidenDue(now) && TryResume(s, now)).Select(s => s.AgentId).ToList();

    /// <summary>One due agent; any check that fails leaves the old process running and never reports an error.</summary>
    private bool TryResume(AgentSession session, DateTimeOffset now)
    {
        var agentId = session.AgentId;
        AgentRecord record;
        try { record = agents.Get(agentId); }
        catch (UnknownAgentException) { return false; }
        if (Asking(agentId))
        {
            session.PostponeWiden(now + QuestionRetry);
            return false;
        }
        if (RespawnResumed(session, record) is not { } launch)
        {
            session.SettleWidth();
            return false;
        }
        agents.MarkStarted(agentId, session.Pid, TerminalAgents.ResolvedCliFor(record.Kind, launch.Argv));
        agents.RecordSessionLaunch(agentId, session);
        return true;
    }

    /// <summary>Restarts the agent on a resume of its own session; the launch used, or null when there is nothing to resume or it cannot restart.</summary>
    private AgentLaunch? RespawnResumed(AgentSession session, AgentRecord record)
    {
        var agentId = session.AgentId;
        var sessionId = record.WorktreeLost ? null : agents.CaptureSessionId(agentId);
        // a session with no transcript yet (nothing said) cannot be resumed, and its banner is not worth a restart
        if (string.IsNullOrEmpty(sessionId) || Transcripts.Locate(sessionId, record.Worktree, projectsRoot) is null) return null;
        var launch = terminalAgents.Resolve(record.Kind, sessionId, agentId: agentId, bridgeUrl: BareSkill.BridgeUrl, newSessionId: Guid.NewGuid().ToString(),
            sessionTrackingFile: AgentSessionOwnership.FileFor(agents.MainRoot, Guid.NewGuid().ToString()), workdir: record.Worktree, delegation: session.Delegation);
        // the CLI may have changed since launch; only a tracked claude can resume the same session
        if (launch is null || !launch.Env.ContainsKey(AgentSessionOwnership.FileEnv)) return null;
        var env = new Dictionary<string, string>(launch.Env);
        BridgeAddress.ExportIdentity(env, agentId, BareSkill.BridgeUrl);
        return sessions.Respawn(session, launch.Argv, record.Worktree, env, paths) ? launch : null;
    }

    /// <summary>Whether the agent still has an ask_user question on the canvas; an unreadable canvas counts as asking.</summary>
    private bool Asking(string agentId)
    {
        try { return asksUser(agentId); }
        catch (Exception error) when (error is not OutOfMemoryException) { return true; }
    }
}
