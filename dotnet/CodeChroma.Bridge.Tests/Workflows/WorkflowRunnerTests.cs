using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workflows;
using CodeChroma.Bridge.Workspaces;
using static CodeChroma.Bridge.Tests.Support.FakeCliHarness;

namespace CodeChroma.Bridge.Tests.Workflows;

/// <summary>The workflow runner against a scripted fake CLI in a real throwaway git repo.</summary>
public sealed class WorkflowRunnerTests : IDisposable
{
    private readonly FakeCliHarness _cli = new();
    private readonly GitSandbox _repo = new();
    private readonly List<string> _events = [];
    private string? _session;

    private static string Say(string text) => "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"" + text + "\"}]}}";

    public void Dispose()
    {
        _cli.Dispose();
        _repo.Dispose();
    }

    private WorkflowRunner Runner()
    {
        var paths = UserPaths.Under(_repo.Sibling("stores"));
        var providers = new ProviderStore(paths);
        var resolver = new CliResolver(paths, providers, new CallSiteStore(paths, providers));
        var runtime = new RuntimeEnvironment(() => new RuntimeSettings(null, 10, new Dictionary<string, string> { ["claude"] = _cli.ExePath }));
        var agents = new SkillAgents(resolver, runtime, new SkillRunSettings { FlushIntervalSeconds = 0.02 });
        return new WorkflowRunner(_repo.Root, agents["workflow-step"], message => { lock (_events) _events.Add(message["event"]!.GetValue<string>()); }, _ => _session,
            agents["workflow-chat"], runId => "http://127.0.0.1:1/mcp/" + runId);
    }

    private void Define(params (string Id, string Kind)[] steps)
    {
        var def = new WorkflowDef
        {
            Id = "wf", Name = "Test flow",
            Steps = steps.Select(s => new WorkflowStep { Id = s.Id, Slug = s.Id, Kind = s.Kind, Prompt = "do " + s.Id }).ToList(),
        };
        var dir = Path.Combine(_repo.Root, ".codechroma", "workflows");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "wf.json"), JsonSerializer.Serialize(def, WorkflowJson.Options));
    }

    private static async Task Until(Func<bool> condition, string what)
    {
        for (var i = 0; i < 800; i++)
        {
            if (condition()) return;
            await Task.Delay(25);
        }
        throw new TimeoutException("timed out waiting for " + what);
    }

    private static Task UntilState(WorkflowRunner runner, string runId, string state) =>
        Until(() => runner.Get(runId).State == state, "state " + state);

    private static StepRecord Step(Run run, string id) => run.Steps.Single(s => s.StepId == id);

    private string Worktree(string runId) => WorkflowRunner.WorktreeFor(_repo.Root, runId);

    [Fact]
    public async Task A_run_walks_its_steps_and_parks_on_the_review_gate_until_approved()
    {
        Define(("build", "agent"), ("check", "review"));
        _cli.Script(Stdout(Say("built")), Write("out.txt", "built\n"), ResultEvent(), Exit(0));
        var runner = Runner();

        var started = await runner.Start("wf");
        await UntilState(runner, started.Id, "needs_you");
        var parked = runner.Get(started.Id);
        var approved = runner.Review(started.Id, "approve", null);

        Assert.Equal("done", approved.State);
        Assert.Equal("done", Step(approved, "build").Status);
        Assert.Equal("done", Step(approved, "check").Status);
        Assert.Equal("check", parked.CurrentStepId);
        Assert.Equal("needs_you", Step(parked, "check").Status);
        Assert.Contains("built", Step(approved, "build").Output);
        Assert.NotNull(Step(approved, "build").CheckpointRef);
        Assert.Contains("1 file changed", Step(approved, "build").DiffStat);
        Assert.Contains("run.done", _events);
        Assert.Single(approved.Attempts);
        Assert.Null(approved.CurrentStepId);
    }

    [Fact]
    public async Task Sending_a_review_back_reruns_the_agent_step_with_the_note_and_returns_to_the_gate()
    {
        Define(("build", "agent"), ("check", "review"));
        _cli.Script(ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        await UntilState(runner, started.Id, "needs_you");

        var sent = runner.Review(started.Id, "sendBack", "rename the helper");
        await Until(() => _cli.Invocations().Count == 2, "second launch");
        await UntilState(runner, started.Id, "needs_you");

        Assert.Equal("running", sent.State);
        Assert.Contains("rename the helper", _cli.Invocations()[1]["args"]!.ToJsonString());
        Assert.Contains("sent back: rename the helper", Step(runner.Get(started.Id), "build").Output);
    }

    [Fact]
    public async Task Stop_now_kills_the_step_and_keeps_the_partial_diff_uncommitted()
    {
        Define(("build", "agent"), ("later", "agent"));
        _cli.Script(Write("partial.txt", "half\n"), Stdout(Say("working")), Hang());
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => File.Exists(Path.Combine(Worktree(started.Id), "partial.txt")), "partial file");
        var headBefore = GitSandbox.GitIn(Worktree(started.Id), "rev-parse", "HEAD").Trim();

        var stopped = await runner.Stop(started.Id, "now");

        Assert.Equal("stopped", stopped.State);
        Assert.Equal("stopped", Step(stopped, "build").Status);
        Assert.Equal("pending", Step(stopped, "later").Status);
        Assert.True(File.Exists(Path.Combine(Worktree(started.Id), "partial.txt")));
        Assert.Contains("partial.txt", GitSandbox.GitIn(Worktree(started.Id), "status", "--porcelain"));
        Assert.Equal(headBefore, GitSandbox.GitIn(Worktree(started.Id), "rev-parse", "HEAD").Trim());
        Assert.Contains("1 file changed", Step(stopped, "build").DiffStat);
        Assert.Contains("run.stopping", _events);
        Assert.Contains("run.stopped", _events);
    }

    [Fact]
    public async Task A_stopped_step_resumes_in_its_saved_session_and_finishes_the_run()
    {
        Define(("build", "agent"));
        _session = "sess-42";
        _cli.ScriptRuns([Write("partial.txt", "half\n"), Hang()], [ResultEvent(), Exit(0)]);
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => File.Exists(Path.Combine(Worktree(started.Id), "partial.txt")), "partial file");
        var stopped = await runner.Stop(started.Id, "now");

        var resumed = runner.ResumeFrom(started.Id, "build");
        await UntilState(runner, started.Id, "done");

        Assert.Equal("sess-42", Step(stopped, "build").SessionId);
        Assert.Equal("running", resumed.State);
        Assert.Contains("--resume", _cli.Invocations()[1]["args"]!.ToJsonString());
        Assert.Contains("sess-42", _cli.Invocations()[1]["args"]!.ToJsonString());
    }

    [Fact]
    public async Task Stop_after_the_step_holds_the_run_at_the_next_step_and_keep_running_clears_the_flag()
    {
        Define(("one", "agent"), ("two", "agent"), ("three", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.Script(BlockUntilFile(release), ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 1, "first launch");

        var armed = await runner.Stop(started.Id, "afterStep");
        File.WriteAllText(release, "go");
        await UntilState(runner, started.Id, "held");
        var held = runner.Get(started.Id);
        var cleared = runner.KeepRunning(started.Id);

        Assert.Equal("one", armed.StopAfter);
        Assert.Equal("running", armed.State);
        Assert.Equal("two", held.CurrentStepId);
        Assert.Equal("done", Step(held, "one").Status);
        Assert.Equal("held", Step(held, "two").Status);
        Assert.Null(held.StopAfter);
        Assert.Null(cleared.StopAfter);
        Assert.Contains("run.held", _events);
        runner.Resume(started.Id);
        await UntilState(runner, started.Id, "done");
    }

    [Fact]
    public async Task A_breakpoint_holds_the_run_before_its_step_and_survives_the_resume()
    {
        Define(("one", "agent"), ("two", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.Script(BlockUntilFile(release), ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        runner.SetBreakpoint(started.Id, "two", true);
        File.WriteAllText(release, "go");

        await UntilState(runner, started.Id, "held");
        var held = runner.Get(started.Id);
        runner.Resume(started.Id);
        await UntilState(runner, started.Id, "done");

        Assert.Equal("two", held.CurrentStepId);
        Assert.Equal("held", Step(held, "two").Status);
        Assert.Equal(["two"], runner.Get(started.Id).Breakpoints);
        Assert.Equal(2, _cli.Invocations().Count);
    }

    [Fact]
    public async Task A_breakpoint_on_a_started_step_is_refused()
    {
        Define(("one", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.Script(BlockUntilFile(release), ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 1, "first launch");

        var error = Assert.Throws<BridgeException>(() => runner.SetBreakpoint(started.Id, "one", true));
        File.WriteAllText(release, "go");

        Assert.Equal(409, error.Status);
        await UntilState(runner, started.Id, "done");
    }

    [Fact]
    public async Task Pause_holds_the_step_output_and_resume_lets_it_finish()
    {
        Define(("one", "agent"));
        var lines = Enumerable.Range(1, 12).Select(i => Say("line" + i)).ToArray();
        _cli.Script(StdoutSlow(150, lines), ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => Step(runner.Get(started.Id), "one").Output.Contains("line1"), "first line");

        var paused = runner.Pause(started.Id);
        await Task.Delay(400);
        var settled = Step(runner.Get(started.Id), "one").Output.Length;
        await Task.Delay(700);
        var later = Step(runner.Get(started.Id), "one").Output.Length;
        runner.Resume(started.Id);
        await UntilState(runner, started.Id, "done");

        Assert.Equal("paused", paused.State);
        Assert.Equal("paused", Step(paused, "one").Status);
        Assert.Equal(settled, later);
        Assert.Contains("line12", Step(runner.Get(started.Id), "one").Output);
        Assert.Contains("run.paused", _events);
        Assert.Contains("run.resumed", _events);
    }

    [Fact]
    public async Task A_failing_step_stops_the_run_with_the_error_in_its_output()
    {
        Define(("one", "agent"));
        _cli.Script(Stderr("boom"), Exit(3));
        var runner = Runner();

        var started = await runner.Start("wf");
        await UntilState(runner, started.Id, "stopped");

        Assert.Equal("stopped", Step(runner.Get(started.Id), "one").Status);
        Assert.Contains("boom", Step(runner.Get(started.Id), "one").Output);
    }

    [Fact]
    public async Task An_illegal_command_is_a_conflict_and_an_unknown_run_is_not_found()
    {
        Define(("one", "agent"), ("check", "review"));
        _cli.Script(ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        await UntilState(runner, started.Id, "needs_you");

        var pause = Assert.Throws<BridgeException>(() => runner.Pause(started.Id));
        var missing = Assert.Throws<BridgeException>(() => runner.Get("run-nope"));

        Assert.Equal(409, pause.Status);
        Assert.Equal(404, missing.Status);
    }

    [Fact]
    public async Task A_restart_turns_an_active_persisted_run_into_a_stopped_one()
    {
        Define(("one", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.Script(BlockUntilFile(release), ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 1, "first launch");

        var reborn = Runner();
        File.WriteAllText(release, "go");

        Assert.Equal("stopped", reborn.Get(started.Id).State);
        Assert.Equal(started.Id, reborn.List().Single().Id);
        Assert.True(File.Exists(Path.Combine(_repo.Root, ".codechroma", "runs", started.Id + ".json")));
        await runner.Idle(started.Id);
    }

    private static string Args(JsonObject invocation) => invocation["args"]!.ToJsonString();

    [Fact]
    public async Task A_message_reaches_only_its_target_agent_and_never_changes_the_run()
    {
        Define(("implement", "agent"), ("hello", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.ScriptRuns([BlockUntilFile(release), ResultEvent(), Exit(0)], [Stdout(Say("the answer")), ResultEvent(), Exit(0)]);
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 1, "step launch");

        var stepReply = await runner.Message(started.Id, "@hello", "what will you do?");
        var afterStep = _cli.Invocations();
        var runReply = await runner.Message(started.Id, "run", "how is it going?");
        var afterRun = _cli.Invocations();
        var during = runner.Get(started.Id);
        File.WriteAllText(release, "go");
        await UntilState(runner, started.Id, "done");

        Assert.Contains("the answer", stepReply.Reply);
        Assert.Contains("the answer", runReply.Reply);
        Assert.Equal(2, afterStep.Count);
        Assert.Contains("Your task was: do hello", Args(afterStep[1]));
        Assert.DoesNotContain("--mcp-config", Args(afterStep[1]));
        Assert.Contains("--strict-mcp-config", Args(afterStep[1]));
        Assert.DoesNotContain("run agent", Args(afterStep[1]));
        Assert.Equal(3, afterRun.Count);
        Assert.Contains("run agent", Args(afterRun[2]));
        Assert.Contains("--mcp-config", Args(afterRun[2]));
        Assert.DoesNotContain("do hello", Args(afterRun[2]));
        Assert.Equal("running", during.State);
        Assert.Equal("running", Step(during, "implement").Status);
        Assert.Equal(["user", "agent", "user", "agent"], during.Messages.Select(m => m.Role));
        Assert.Equal(["hello", "hello", "run", "run"], during.Messages.Select(m => m.Target));
        Assert.Contains("run.message", _events);
    }

    [Fact]
    public async Task The_run_agent_mcp_can_pause_stop_and_only_propose_a_redo()
    {
        Define(("one", "agent"), ("two", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.ScriptRuns([BlockUntilFile(release), ResultEvent(), Exit(0)], [Stdout(Say("ok")), ResultEvent(), Exit(0)]);
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 1, "step launch");
        await runner.Message(started.Id, "run", "hi");
        var args = _cli.Invocations()[1]["args"]!.AsArray().Select(a => a!.GetValue<string>()).ToList();
        var config = JsonNode.Parse(args[args.IndexOf("--mcp-config") + 1])!["mcpServers"]![WorkflowRunner.McpServerName]!;
        var bearer = config["headers"]!["Authorization"]!.GetValue<string>();

        async Task<JsonObject> Call(string name, JsonObject arguments) => (await runner.HandleMcp(started.Id, bearer, new JsonObject
        {
            ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = "tools/call", ["params"] = new JsonObject { ["name"] = name, ["arguments"] = arguments },
        }))!;

        var listed = (await runner.HandleMcp(started.Id, bearer, new JsonObject { ["id"] = 1, ["method"] = "tools/list" }))!;
        var proposed = await Call("propose_redo", new JsonObject { ["from"] = "one", ["note"] = "better" });
        var paused = await Call("pause", []);
        var state = runner.Get(started.Id);
        var denied = await Assert.ThrowsAsync<BridgeException>(() => runner.HandleMcp(started.Id, "Bearer nope", new JsonObject { ["id"] = 1, ["method"] = "ping" }));
        var unknown = await Call("redo", []);
        runner.Resume(started.Id);
        File.WriteAllText(release, "go");
        await UntilState(runner, started.Id, "done");

        Assert.Equal(["pause", "stop", "propose_redo"], listed["result"]!["tools"]!.AsArray().Select(t => t!["name"]!.GetValue<string>()));
        Assert.False(proposed["result"]!["isError"]!.GetValue<bool>());
        Assert.False(paused["result"]!["isError"]!.GetValue<bool>());
        Assert.True(unknown["result"]!["isError"]!.GetValue<bool>());
        Assert.Equal("paused", state.State);
        Assert.Equal("one", state.RedoProposal!.From);
        Assert.Equal(["one", "two"], state.RedoProposal.Card.Reruns);
        Assert.Equal("better", state.RedoProposal.Card.Note);
        Assert.Equal(401, denied.Status);
        Assert.Contains("run.redo.proposed", _events);
    }

    [Fact]
    public async Task Redo_sets_the_attempt_aside_keeps_earlier_steps_and_preserves_breakpoints()
    {
        Define(("one", "agent"), ("two", "agent"), ("three", "agent"));
        _cli.ScriptRuns([Write("one.txt", "1\n"), ResultEvent(), Exit(0)], [Write("two.txt", "2\n"), ResultEvent(), Exit(0)], [Write("two_v2.txt", "2b\n"), ResultEvent(), Exit(0)]);
        var runner = Runner();
        var started = await runner.Start("wf");
        runner.SetBreakpoint(started.Id, "three", true);
        await UntilState(runner, started.Id, "held");
        var before = runner.Get(started.Id);

        var redone = await runner.Redo(started.Id, "two", "use b", null);
        await Until(() => runner.Get(started.Id) is { State: "held", Attempt: 2 }, "second hold");
        var after = runner.Get(started.Id);
        var worktree = Worktree(started.Id);

        Assert.Equal("running", redone.State);
        Assert.Equal(2, after.Attempt);
        Assert.Equal([1, 2], after.Attempts.Select(a => a.N));
        Assert.Equal(started.Id + "/attempt-1", after.Attempts[0].Branch);
        Assert.Equal("workflow/" + started.Id, after.Attempts[1].Branch);
        Assert.Contains(started.Id + "/attempt-1", GitSandbox.GitIn(_repo.Root, "branch", "--list"));
        Assert.Contains("2", GitSandbox.GitIn(_repo.Root, "show", started.Id + "/attempt-1:two.txt"));
        Assert.Equal(3, after.Attempts[0].Steps!.Count);
        Assert.Equal("done", after.Attempts[0].Steps!.Single(s => s.StepId == "two").Status);
        Assert.Equal(["three"], after.Breakpoints);
        Assert.Equal("held", Step(after, "three").Status);
        Assert.Equal(1, Step(after, "one").FromAttempt);
        Assert.Equal(2, Step(after, "one").Attempt);
        Assert.Equal(Step(before, "one").Output, Step(after, "one").Output);
        Assert.Equal(Step(before, "one").CheckpointRef, Step(after, "one").CheckpointRef);
        Assert.StartsWith("--- redo note: use b ---", Step(after, "two").Output);
        Assert.Equal(2, Step(after, "two").Attempt);
        Assert.Null(Step(after, "two").FromAttempt);
        Assert.Equal("done", Step(after, "two").Status);
        Assert.True(File.Exists(Path.Combine(worktree, "one.txt")));
        Assert.False(File.Exists(Path.Combine(worktree, "two.txt")));
        Assert.True(File.Exists(Path.Combine(worktree, "two_v2.txt")));
        Assert.Equal(3, _cli.Invocations().Count);
        Assert.Contains("use b", Args(_cli.Invocations()[2]));
        Assert.Contains("run.redo.started", _events);
    }

    [Fact]
    public async Task Redo_is_refused_while_running_and_a_cancelled_proposal_leaves_the_run_stopped()
    {
        Define(("one", "agent"));
        _cli.Script(Hang());
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 1, "step launch");

        var refused = await Assert.ThrowsAsync<BridgeException>(() => runner.Redo(started.Id, "one", null, null));
        await runner.Stop(started.Id, "now");
        runner.ProposeRedo(started.Id, "one", "again");
        var cancelled = runner.CancelRedo(started.Id);

        Assert.Equal(409, refused.Status);
        Assert.Equal("stopped", cancelled.State);
        Assert.Null(cancelled.RedoProposal);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task A_step_edit_applies_to_the_run_and_reaches_the_workflow_only_when_asked(bool save)
    {
        Define(("one", "agent"));
        _cli.ScriptRuns([Hang()], [ResultEvent(), Exit(0)]);
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 1, "step launch");
        await runner.Stop(started.Id, "now");

        await runner.Redo(started.Id, "one", null, new StepEdit { Prompt = "do it differently", SaveToWorkflow = save });
        await UntilState(runner, started.Id, "done");
        var run = runner.Get(started.Id);
        var workflowFile = File.ReadAllText(Path.Combine(_repo.Root, ".codechroma", "workflows", "wf.json"));

        Assert.Contains("do it differently", Args(_cli.Invocations()[1]));
        Assert.Equal(save, workflowFile.Contains("do it differently"));
        Assert.Equal(!save, run.PromptOverrides.ContainsKey("one"));
    }

    [Fact]
    public async Task Stopping_a_held_run_keeps_its_step_unstarted_so_resuming_it_is_not_an_interrupted_attempt()
    {
        Define(("one", "agent"), ("two", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.Script(BlockUntilFile(release), ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        runner.SetBreakpoint(started.Id, "two", true);
        File.WriteAllText(release, "go");
        await UntilState(runner, started.Id, "held");

        var stopped = await runner.Stop(started.Id, "now");
        runner.ResumeFrom(started.Id, "two");
        await UntilState(runner, started.Id, "done");

        Assert.Equal("pending", Step(stopped, "two").Status);
        Assert.DoesNotContain("interrupted", Args(_cli.Invocations()[1]));
    }

    [Fact]
    public async Task Saving_a_step_edit_to_the_workflow_leaves_other_steps_temporary_prompts_out_of_it()
    {
        Define(("one", "agent"), ("two", "agent"));
        _cli.ScriptRuns([ResultEvent(), Exit(0)], [Hang()], [ResultEvent(), Exit(0)], [Hang()], [ResultEvent(), Exit(0)]);
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 2, "step two launch");
        await runner.Stop(started.Id, "now");
        await runner.Redo(started.Id, "one", null, new StepEdit { Prompt = "temporary one", SaveToWorkflow = false });
        await Until(() => _cli.Invocations().Count == 4, "second step two launch");
        await runner.Stop(started.Id, "now");

        await runner.Redo(started.Id, "two", null, new StepEdit { Prompt = "saved two", SaveToWorkflow = true });
        await UntilState(runner, started.Id, "done");
        var workflowFile = File.ReadAllText(Path.Combine(_repo.Root, ".codechroma", "workflows", "wf.json"));

        Assert.Contains("saved two", workflowFile);
        Assert.DoesNotContain("temporary one", workflowFile);
        Assert.Equal("temporary one", runner.Get(started.Id).PromptOverrides["one"]);
    }

    [Fact]
    public async Task Two_simultaneous_messages_to_one_agent_let_exactly_one_through()
    {
        Define(("one", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.ScriptRuns([Hang()], [BlockUntilFile(release), Stdout(Say("answer")), ResultEvent(), Exit(0)]);
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 1, "step launch");

        var first = Task.Run(() => runner.Message(started.Id, "run", "a"));
        var second = Task.Run(() => runner.Message(started.Id, "run", "b"));
        await Task.Delay(500);
        File.WriteAllText(release, "go");
        var outcomes = await Task.WhenAll(Settle(first), Settle(second));
        await runner.Stop(started.Id, "now");

        Assert.Single(outcomes, outcome => outcome == "ok");
        Assert.Single(outcomes, outcome => outcome == "409");
        Assert.Equal(2, _cli.Invocations().Count);
    }

    private static async Task<string> Settle(Task<MessageReply> message)
    {
        try
        {
            await message;
            return "ok";
        }
        catch (BridgeException error)
        {
            return error.Status.ToString();
        }
    }

    [Fact]
    public async Task The_run_mcp_answers_malformed_requests_as_errors_and_does_not_reveal_which_runs_exist()
    {
        Define(("one", "agent"));
        _cli.ScriptRuns([Hang()], [Stdout(Say("ok")), ResultEvent(), Exit(0)]);
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => _cli.Invocations().Count == 1, "step launch");
        await runner.Message(started.Id, "run", "hi");
        var args = _cli.Invocations()[1]["args"]!.AsArray().Select(a => a!.GetValue<string>()).ToList();
        var bearer = JsonNode.Parse(args[args.IndexOf("--mcp-config") + 1])!["mcpServers"]![WorkflowRunner.McpServerName]!["headers"]!["Authorization"]!.GetValue<string>();

        var unknownRun = await Assert.ThrowsAsync<BridgeException>(() => runner.HandleMcp("run-nope", bearer, new JsonObject { ["id"] = 1, ["method"] = "ping" }));
        var numericMethod = await runner.HandleMcp(started.Id, bearer, new JsonObject { ["id"] = 1, ["method"] = 5 });
        var scalarParams = await runner.HandleMcp(started.Id, bearer, new JsonObject { ["id"] = 2, ["method"] = "tools/call", ["params"] = 7 });
        var objectMode = await runner.HandleMcp(started.Id, bearer, new JsonObject
        {
            ["id"] = 3, ["method"] = "tools/call", ["params"] = new JsonObject { ["name"] = "stop", ["arguments"] = new JsonObject { ["mode"] = new JsonObject() } },
        });
        await runner.Stop(started.Id, "now");

        Assert.Equal(401, unknownRun.Status);
        Assert.Equal(-32601, numericMethod!["error"]!["code"]!.GetValue<int>());
        Assert.True(scalarParams!["result"]!["isError"]!.GetValue<bool>());
        Assert.True(objectMode!["result"]!["isError"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Output_that_arrives_while_the_run_is_paused_is_held_until_resume()
    {
        Define(("one", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.Script(Stdout(Say("early")), BlockUntilFile(release), Stdout(Say("late")), ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => Step(runner.Get(started.Id), "one").Output.Contains("early"), "early line");

        var paused = runner.Pause(started.Id);
        File.WriteAllText(release, "go");
        await Task.Delay(700);
        var held = runner.Get(started.Id);
        runner.Resume(started.Id);
        await UntilState(runner, started.Id, "done");

        Assert.Equal("paused", paused.State);
        Assert.Equal("paused", Step(held, "one").Status);
        Assert.DoesNotContain("late", Step(held, "one").Output);
        Assert.Contains("late", Step(runner.Get(started.Id), "one").Output);
        Assert.Equal(1, Step(runner.Get(started.Id), "one").Output.Split("late").Length - 1);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Stop_now_while_paused_with_a_silent_or_gated_cli_does_not_hang(bool lineArrivesWhilePaused)
    {
        Define(("one", "agent"));
        var release = Path.Combine(_cli.Directory, "release");
        _cli.Script(Stdout(Say("firstline")), BlockUntilFile(release), Stdout(Say("secondline")), Hang());
        var runner = Runner();
        var started = await runner.Start("wf");
        await Until(() => Step(runner.Get(started.Id), "one").Output.Contains("firstline"), "first line");
        runner.Pause(started.Id);
        if (lineArrivesWhilePaused)
        {
            File.WriteAllText(release, "go");
            await Task.Delay(500);
        }

        var whilePaused = Step(runner.Get(started.Id), "one").Output;
        var stopped = await runner.Stop(started.Id, "now").WaitAsync(TimeSpan.FromSeconds(15));

        Assert.Equal("stopped", stopped.State);
        Assert.Equal("stopped", Step(stopped, "one").Status);
        Assert.DoesNotContain("secondline", whilePaused);
    }

    [Fact]
    public void A_marker_key_never_leaves_the_marker_directory()
    {
        var path = WorkflowRunner.Marker("chat", "run:1\\..\\x/y");

        Assert.Equal("codechroma-workflow-steps", Path.GetFileName(Path.GetDirectoryName(path)));
        Assert.DoesNotContain('\\', Path.GetFileName(path));
        Assert.DoesNotContain('/', Path.GetFileName(path));
        Assert.DoesNotContain(':', Path.GetFileName(path));
    }

    [Fact]
    public async Task Redo_keeps_the_attempt_on_a_suffixed_branch_when_the_name_is_taken()
    {
        Define(("one", "agent"));
        _cli.Script(Write("one.txt", "1\n"), ResultEvent(), Exit(0));
        var runner = Runner();
        var started = await runner.Start("wf");
        await UntilState(runner, started.Id, "done");
        GitSandbox.GitIn(_repo.Root, "branch", started.Id + "/attempt-1");

        await runner.Redo(started.Id, "one", null, null);
        await UntilState(runner, started.Id, "done");
        var run = runner.Get(started.Id);

        Assert.Equal(started.Id + "/attempt-1-2", run.Attempts[0].Branch);
        Assert.Contains(started.Id + "/attempt-1-2", GitSandbox.GitIn(_repo.Root, "branch", "--list"));
    }

    [Fact]
    public void A_failed_reset_removes_the_attempt_branch_again()
    {
        var error = Assert.Throws<WorktreeException>(() => WorktreeOps.SetAside(_repo.Root, _repo.Root, "aside", "0000000000000000000000000000000000000000", "set aside"));

        Assert.Contains("aside", error.Message);
        Assert.DoesNotContain("aside", GitSandbox.GitIn(_repo.Root, "branch", "--list"));
    }

    [Fact]
    public void Simultaneous_fake_cli_launches_get_distinct_launch_indexes()
    {
        const int count = 8;
        var runs = Enumerable.Range(0, count).Select(i => new[] { Write(Path.Combine(_cli.Directory, $"out-{i}"), "x"), Exit(0) }).ToArray();
        _cli.ScriptRuns(runs);

        var processes = Enumerable.Range(0, count).Select(_ => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(_cli.ExePath) { UseShellExecute = false, CreateNoWindow = true })!).ToList();
        foreach (var process in processes) { process.WaitForExit(); process.Dispose(); }

        Assert.Equal(count, Directory.GetFiles(_cli.Directory, "out-*").Length);
    }
}
