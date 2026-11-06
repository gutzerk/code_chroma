using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;
using static CodeChroma.Bridge.Tests.Support.FakeCliHarness;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>A wider window restarts an idle claude agent with --resume, so its whole conversation reprints at the new width.</summary>
[Collection("Session ownership")]
public sealed class WidenResumeTests : IDisposable
{
    private readonly FakeCliHarness _cli = new();
    private readonly GitSandbox _repo = new();
    private readonly List<AgentSession> _sessions = [];

    public void Dispose()
    {
        foreach (var session in _sessions) session.Dispose();
        _repo.Dispose();
        _cli.Dispose();
    }

    private static readonly JsonObject StopHook = new() { ["hook_event_name"] = "Stop" };

    private AgentSession Launch(string? trackingFile = "owned.json", params string[] extraArgs)
    {
        var env = trackingFile is null ? null : new Dictionary<string, string> { [AgentSessionOwnership.FileEnv] = trackingFile };
        var session = new AgentSession("agent", new PtyLaunch([_cli.ExePath, .. extraArgs], _repo.Root, env));
        _sessions.Add(session);
        return session;
    }

    private static void WaitFor(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("condition never held");
            Thread.Sleep(20);
        }
    }

    private static bool Shows(AgentSession session, string text) => string.Join("\n", session.Screen.Tail(200)).Contains(text);

    private AgentSession PrintedAt120ThenIdle()
    {
        _cli.Script(Stdout("printed"), Hang());
        var session = Launch();
        WaitFor(() => Shows(session, "printed"));
        session.ApplyHook(StopHook.DeepClone().AsObject());
        return session;
    }

    private static DateTimeOffset Later => DateTimeOffset.UtcNow.AddSeconds(10);

    [Fact]
    public void Widening_an_idle_agent_past_its_printed_width_is_due_once_the_resize_settles()
    {
        var session = PrintedAt120ThenIdle();

        session.Resize(30, 160);

        Assert.False(session.WidenDue(DateTimeOffset.UtcNow));
        Assert.True(session.WidenDue(Later));
    }

    [Theory]
    [InlineData(124)]
    [InlineData(100)]
    public void A_small_widening_or_a_narrowing_is_never_due(int cols)
    {
        var session = PrintedAt120ThenIdle();

        session.Resize(30, cols);

        Assert.False(session.WidenDue(Later));
    }

    [Fact]
    public void A_busy_agent_waits_until_it_idles()
    {
        var session = PrintedAt120ThenIdle();
        session.ApplyHook(new JsonObject { ["hook_event_name"] = "UserPromptSubmit" });
        session.Resize(30, 160);

        var busy = session.WidenDue(Later);
        session.ApplyHook(StopHook.DeepClone().AsObject());

        Assert.False(busy);
        Assert.True(session.WidenDue(Later));
    }

    [Fact]
    public void A_draft_in_the_prompt_holds_the_widen_until_it_is_sent()
    {
        var session = PrintedAt120ThenIdle();
        session.Resize(30, 160);

        session.Write("half typed");
        var drafting = session.WidenDue(Later);
        session.Write("\r");

        Assert.False(drafting);
        Assert.True(session.WidenDue(Later));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("--system-prompt")]
    public void Untracked_or_bare_launches_never_resume_on_widen(string? bareFlag)
    {
        _cli.Script(Stdout("printed"), Hang());
        var session = bareFlag is null ? Launch(trackingFile: null) : Launch("owned.json", bareFlag, "skill");
        WaitFor(() => Shows(session, "printed"));
        session.ApplyHook(StopHook.DeepClone().AsObject());

        session.Resize(30, 160);

        Assert.False(session.WidenDue(Later));
    }

    [Fact]
    public void Attached_windows_counts_each_attach_until_its_detach()
    {
        _cli.Script(Stdout("ready"), Hang());
        var session = Launch();
        WaitFor(() => Shows(session, "ready"));
        var before = session.AttachedWindows;

        var first = session.Attach();
        var second = session.Attach();
        var both = session.AttachedWindows;
        session.Detach(first);
        var one = session.AttachedWindows;
        session.Detach(second);

        Assert.Equal((0, 2, 1, 0), (before, both, one, session.AttachedWindows));
    }

    [Fact]
    public void Respawn_clears_the_old_screen_and_streams_the_new_process_to_attached_windows()
    {
        _cli.ScriptRuns([Stdout("first run"), Hang()], [Stdout("second run"), Hang()]);
        var exited = false;
        var session = new AgentSession("agent", new PtyLaunch([_cli.ExePath], _repo.Root), onExit: _ => exited = true);
        _sessions.Add(session);
        WaitFor(() => Shows(session, "first run"));
        var window = session.Attach();
        session.Resize(30, 160);

        var respawned = session.Respawn([_cli.ExePath, "--resume", "abc"], _repo.Root, null);
        WaitFor(() => Shows(session, "second run"));
        var streamed = "";
        while (window.Output.TryRead(out var chunk)) streamed += chunk;

        Assert.True(respawned);
        Assert.True(session.IsAlive);
        Assert.False(exited);
        Assert.False(Shows(session, "first run"));
        Assert.True(streamed.IndexOf(AgentSession.ResetScreen, StringComparison.Ordinal) < streamed.IndexOf("second run", StringComparison.Ordinal));
        Assert.Equal(["--resume", "abc"], _cli.Invocations()[1]["args"]!.AsArray().Select(a => (string?)a).TakeLast(2));
        Assert.Equal((30, 160), (session.Screen.Rows, session.Screen.Cols));
    }

    [Fact]
    public async Task A_respawn_while_an_injection_is_queued_is_refused_and_keeps_the_old_process()
    {
        var session = PrintedAt120ThenIdle();
        session.Resize(30, 160);
        var pid = session.Pid;
        var injection = session.InjectWhenIdle("answer", attempts: 3, interval: TimeSpan.FromMilliseconds(20));

        var respawned = session.Respawn([_cli.ExePath, "--resume", "abc"], _repo.Root, null);
        await injection;

        Assert.False(respawned);
        Assert.Equal(pid, session.Pid);
        Assert.Single(_cli.Invocations());
    }

    [Theory]
    [InlineData("half typed")]
    [InlineData("sent\r")]
    public void A_respawn_right_after_typing_is_refused(string typed)
    {
        var session = PrintedAt120ThenIdle();
        session.Write(typed);

        var respawned = session.Respawn([_cli.ExePath, "--resume", "abc"], _repo.Root, null);

        Assert.False(respawned);
        Assert.Single(_cli.Invocations());
    }

    [Theory]
    [InlineData(true, "abc")]
    [InlineData(true, "abc\u007f")]
    [InlineData(false, "abc\u007f\u007f\u007f")]
    [InlineData(false, "abc\r")]
    [InlineData(false, "abc", "\u0015")]
    [InlineData(true, "\u001b[A")]
    [InlineData(false, "\u001b[A", "\r")]
    [InlineData(true, "\u001b[200~line\r\u001b[201~")]
    [InlineData(false, "\u001b[I", "\u001b[O", "\u001b")]
    public void The_draft_follows_text_backspace_submit_and_history_recall(bool draft, params string[] writes)
    {
        var session = PrintedAt120ThenIdle();

        foreach (var data in writes) session.Write(data);

        Assert.Equal(draft, session.HasDraft);
    }

    [Fact]
    public void A_session_replaced_during_the_sweep_is_not_respawned()
    {
        _cli.Script(Stdout("printed"), Hang());
        var h = Coordinator();
        var stale = h.Sessions.Get(h.Record.Id)!;
        WaitFor(() => Shows(stale, "printed"));
        h.Sessions.Stop(h.Record.Id);
        var fresh = h.Sessions.Start(h.Record.Id, [_cli.ExePath], h.Record.Worktree);
        WaitFor(() => Shows(fresh, "printed"));
        var freshPid = fresh.Pid;

        var respawned = h.Sessions.Respawn(stale, [_cli.ExePath, "--resume", "abc"], h.Record.Worktree, null);

        Assert.False(respawned);
        Assert.Same(fresh, h.Sessions.Get(h.Record.Id));
        Assert.Equal(freshPid, fresh.Pid);
    }

    private sealed record Harness(WidenResume Widen, AgentManager Agents, AgentSessionRegistry Sessions, AgentRecord Record, string Projects);

    private Harness Coordinator(bool asking = false, bool transcript = true)
    {
        var paths = UserPaths.Under(_repo.Sibling("home"));
        JsonFile.Write(paths.Runtime, new JsonObject { ["cli_paths"] = new JsonObject { ["claude"] = _cli.ExePath } });
        var providers = new ProviderStore(paths);
        var terminal = new TerminalAgents(paths, providers, new CallSiteStore(paths, providers));
        var branches = new BranchManager(_repo.Root);
        var tab = branches.CreateNext(null).Record;
        var agents = new AgentManager(_repo.Root) { BranchLookup = branches.Find };
        var record = agents.Create("wide", workspace: tab.Id);
        var sessionId = Guid.NewGuid().ToString();
        record.SessionId = sessionId;
        agents.Save();
        var projects = _repo.Sibling("projects");
        if (transcript)
        {
            Directory.CreateDirectory(Path.Combine(projects, "p"));
            File.WriteAllText(Path.Combine(projects, "p", sessionId + ".jsonl"), "{}\n");
        }
        var sessions = new AgentSessionRegistry(new RuntimeEnvironment(() => new RuntimeSettings(null, 10, new Dictionary<string, string> { ["claude"] = _cli.ExePath })));
        var launch = terminal.Resolve("claude", sessionId, agentId: record.Id, newSessionId: Guid.NewGuid().ToString(),
            sessionTrackingFile: AgentSessionOwnership.FileFor(agents.MainRoot, Guid.NewGuid().ToString()), workdir: record.Worktree)!;
        var session = sessions.Start(record.Id, launch.Argv, record.Worktree, "claude", launch.Env, paths);
        agents.RecordSessionLaunch(record.Id, session);
        return new Harness(new WidenResume(agents, sessions, terminal, paths, _ => asking, projects), agents, sessions, record, projects);
    }

    private static AgentSession DueSession(Harness h)
    {
        var session = h.Sessions.Get(h.Record.Id)!;
        WaitFor(() => Shows(session, "printed"));
        session.ApplyHook(StopHook.DeepClone().AsObject());
        session.Resize(30, 160);
        return session;
    }

    [Fact]
    public void A_due_agent_is_resumed_in_place_with_its_own_session_and_a_new_tracking_file()
    {
        _cli.ScriptRuns([Stdout("printed"), Hang()], [Stdout("resumed"), Hang()]);
        var h = Coordinator();
        var session = DueSession(h);
        var oldTracking = h.Record.SessionTrackingId;
        var sessionId = h.Record.SessionId;

        var resumed = h.Widen.Sweep(Later);
        WaitFor(() => Shows(session, "resumed"));

        Assert.Equal([h.Record.Id], resumed);
        Assert.Same(session, h.Sessions.Get(h.Record.Id));
        var args = _cli.Invocations()[1]["args"]!.AsArray().Select(a => (string?)a).ToList();
        Assert.Equal(sessionId, args[args.IndexOf("--resume") + 1]);
        Assert.NotEqual(oldTracking, h.Agents.Get(h.Record.Id).SessionTrackingId);
        Assert.Equal(sessionId, h.Agents.Get(h.Record.Id).SessionId);
        Assert.False(session.WidenDue(Later));
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void An_open_question_or_a_missing_transcript_leaves_the_agent_running(bool asking, bool transcript)
    {
        _cli.ScriptRuns([Stdout("printed"), Hang()], [Stdout("resumed"), Hang()]);
        var h = Coordinator(asking, transcript);
        DueSession(h);

        var resumed = h.Widen.Sweep(Later);

        Assert.Empty(resumed);
        Assert.Single(_cli.Invocations());
    }
}
