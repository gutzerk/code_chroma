using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using static CodeChroma.Bridge.Tests.Support.FakeCliHarness;

namespace CodeChroma.Bridge.Tests.Skills;

/// <summary>SkillAgent against a scripted fake CLI executable: no real Claude, no network.</summary>
public sealed class SkillAgentTests : IDisposable
{
    private readonly FakeCliHarness _cli = new();
    private readonly string _root = Path.Combine(Path.GetTempPath(), "cc-skill-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly List<(string Key, JobState State)> _changes = [];
    private readonly List<string> _pushed = [];

    public SkillAgentTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        _cli.Dispose();
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    private string Artifact(string repoId = "job-a") => Path.Combine(_root, repoId + ".json");

    private SkillAgent Agent(Func<JsonNode?, bool>? validate = null, int timeoutSeconds = 20, string timeoutEnv = "CC_TEST_TIMEOUT_UNSET", UserPaths? paths = null,
        string? cliPath = null, RunBody? body = null)
    {
        paths ??= UserPaths.Under(Path.Combine(_root, "stores"));
        var providers = new ProviderStore(paths);
        var resolver = new CliResolver(paths, providers, new CallSiteStore(paths, providers));
        var runtime = new RuntimeEnvironment(() => new RuntimeSettings(null, 10, new Dictionary<string, string> { ["claude"] = cliPath ?? _cli.ExePath }));
        var spec = new SkillAgentSpec("test_agent", "default prompt", "haiku", (root, id) => Path.Combine(root, id + ".json"),
            validate ?? (data => data is JsonObject), timeoutEnv, timeoutSeconds, "no valid artifact", body);
        return new SkillAgent(spec, resolver, runtime, new SkillRunSettings { FlushIntervalSeconds = 0.02 });
    }

    private Task OnChange(string key, JobState state)
    {
        lock (_changes) _changes.Add((key, state));
        return Task.CompletedTask;
    }

    private Task OnOutput(string key, IReadOnlyList<string> lines)
    {
        lock (_pushed) _pushed.AddRange(lines);
        return Task.CompletedTask;
    }

    private async Task<JobState> Settled(SkillAgent agent, string key = "job-a")
    {
        for (var i = 0; i < 400; i++)
        {
            var state = agent.GetState(key);
            if (state.State != "generating") return state;
            await Task.Delay(25);
        }
        throw new TimeoutException("run did not settle");
    }

    [Fact]
    public async Task A_successful_run_leaves_a_valid_artifact_and_reports_idle()
    {
        _cli.Script(Stdout("""{"type":"assistant","message":{"content":[{"type":"text","text":"Mapping."}]}}"""), Write(Artifact(), "{\"nodes\":[]}"), ResultEvent(2000), Exit(0));
        var agent = Agent();

        var started = await agent.Start("job-a", _root, OnChange, OnOutput);
        var final = await Settled(agent);

        Assert.Equal("generating", started.State);
        Assert.Equal(new JobState("idle", null), final);
        Assert.Equal(["generating", "idle"], _changes.Select(c => c.State.State));
        Assert.Equal(["Mapping.", "✓ done in 2s"], agent.GetOutput("job-a"));
        Assert.Contains("✓ done in 2s", _pushed);
        Assert.True(agent.HasArtifact(_root, "job-a"));
    }

    [Fact]
    public async Task Concurrent_starts_for_one_key_launch_a_single_run()
    {
        _cli.Script(Sleep(300), Write(Artifact(), "{}"), Exit(0));
        var agent = Agent();

        var states = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => agent.Start("job-a", _root, OnChange)));
        await Settled(agent);

        Assert.All(states, s => Assert.Equal("generating", s.State));
        Assert.Single(_cli.Invocations());
    }

    [Fact]
    public async Task Stop_right_after_start_cancels_cleanly()
    {
        _cli.Script(Hang());
        var agent = Agent();

        var start = agent.Start("job-a", _root, OnChange);
        var stop = agent.Stop("job-a");
        await Task.WhenAll(start, stop);

        Assert.Equal("idle", agent.GetState("job-a").State);
    }

    [Fact]
    public async Task The_cli_is_launched_in_the_repo_with_the_prompt_the_model_and_the_workspace_id()
    {
        _cli.Script(["codechroma_WORKSPACE_ID"], Write(Artifact(), "{}"), Exit(0));
        var agent = Agent();

        await agent.Start("job-a", _root, OnChange, prompt: "per-run prompt");
        await Settled(agent);

        var call = Assert.Single(_cli.Invocations());
        var args = call["args"]!.AsArray().Select(a => a!.GetValue<string>()).ToList();
        Assert.Equal(["-p", "per-run prompt", "--model", "haiku"], args.Take(4));
        Assert.Equal("job-a", call["env"]!["codechroma_WORKSPACE_ID"]!.GetValue<string>());
        Assert.Equal(Path.GetFullPath(_root).TrimEnd('\\', '/'), Path.GetFullPath(call["cwd"]!.GetValue<string>()).TrimEnd('\\', '/'), ignoreCase: OperatingSystem.IsWindows());
    }

    [Fact]
    public async Task A_failed_run_rolls_the_artifact_back_and_reports_the_error_line()
    {
        File.WriteAllText(Artifact(), "{\"good\":true}");
        _cli.Script(Write(Artifact(), "{\"half"), Stdout("""{"type":"result","is_error":true,"result":"API Error: boom"}"""), Stderr("noise"), Exit(1));
        var agent = Agent();

        await agent.Start("job-a", _root, OnChange);
        var final = await Settled(agent);

        Assert.Equal("error", final.State);
        Assert.Equal("✗ API Error: boom", final.Error);
        Assert.Equal("{\"good\":true}", File.ReadAllText(Artifact()));
    }

    [Theory]
    [InlineData("the stderr text", "the stderr text")]
    [InlineData("", "claude exited 3")]
    public async Task Without_an_error_line_stderr_then_the_exit_code_explain_a_failure(string stderr, string expected)
    {
        _cli.Script(Stderr(stderr), Exit(3));
        var agent = Agent();

        await agent.Start("job-a", _root, OnChange);
        var final = await Settled(agent);

        Assert.Equal(expected, final.Error);
    }

    [Fact]
    public async Task An_invalid_artifact_is_removed_when_nothing_existed_before()
    {
        _cli.Script(Write(Artifact(), "not json"), Exit(0));
        var agent = Agent();

        await agent.Start("job-a", _root, OnChange);
        var final = await Settled(agent);

        Assert.Equal(new JobState("error", "no valid artifact"), final);
        Assert.False(File.Exists(Artifact()));
    }

    [Fact]
    public async Task A_run_that_exceeds_the_timeout_is_killed_and_rolled_back()
    {
        File.WriteAllText(Artifact(), "{\"good\":true}");
        _cli.Script(Write(Artifact(), "{\"half"), Hang());
        Environment.SetEnvironmentVariable("CC_TEST_TIMEOUT_A", "1");
        var agent = Agent(timeoutEnv: "CC_TEST_TIMEOUT_A");

        await agent.Start("job-a", _root, OnChange);
        var final = await Settled(agent);

        Assert.Equal(new JobState("error", "generation timed out"), final);
        Assert.Equal("{\"good\":true}", File.ReadAllText(Artifact()));
    }

    [Fact]
    public async Task Stop_kills_an_in_flight_run_restores_the_artifact_and_resets_to_idle()
    {
        File.WriteAllText(Artifact(), "{\"scope\":[]}");
        _cli.Script(Write(Artifact(), "{\"scope\":[\"half-written"), Hang());
        var agent = Agent();
        await agent.Start("job-a", _root, OnChange);
        await Task.Delay(1500);

        var state = await agent.Stop("job-a");

        Assert.Equal(new JobState("idle", null), state);
        Assert.Equal(new JobState("idle", null), agent.GetState("job-a"));
        Assert.Equal("{\"scope\":[]}", File.ReadAllText(Artifact()));
    }

    [Fact]
    public async Task A_second_start_while_generating_reattaches_instead_of_spawning_again()
    {
        _cli.Script(Hang());
        var agent = Agent();

        var first = await agent.Start("job-a", _root, OnChange);
        await Task.Delay(1500);
        var second = await agent.Start("job-a", _root, OnChange);
        await agent.Forget("job-a");

        Assert.Equal("generating", first.State);
        Assert.Equal("generating", second.State);
        Assert.Single(_cli.Invocations());
    }

    [Fact]
    public async Task A_missing_cli_is_reported_as_an_error_without_spawning()
    {
        var agent = Agent(cliPath: Path.Combine(_root, "missing", "claude"));

        var state = await agent.Start("job-a", _root, OnChange);

        Assert.Equal("error", state.State);
        Assert.Contains("does not exist", state.Error);
        Assert.Empty(_cli.Invocations());
        Assert.Equal(state, agent.GetState("job-a"));
    }

    [Fact]
    public async Task Marking_generating_and_done_flips_state_without_a_process()
    {
        var agent = Agent();

        var generating = await agent.MarkGenerating("job-a", OnChange);
        var again = await agent.MarkGenerating("job-a", OnChange);
        var errored = await agent.MarkDone("job-a", OnChange, "bad");
        var idle = await agent.MarkDone("job-a", OnChange);

        Assert.Equal("generating", generating.State);
        Assert.Equal(generating, again);
        Assert.Equal(new JobState("error", "bad"), errored);
        Assert.Equal(new JobState("idle", null), idle);
        Assert.Equal(3, _changes.Count);
        Assert.Empty(_cli.Invocations());
    }

    [Fact]
    public async Task Forget_drops_the_repo_and_its_composite_job_keys_only()
    {
        var agent = Agent();
        await agent.MarkDone("main:EP-1", OnChange, "x");
        await agent.MarkDone("main", OnChange, "x");
        await agent.MarkDone("pr-1:EP-1", OnChange, "x");

        await agent.Forget("main");

        Assert.Equal("idle", agent.GetState("main:EP-1").State);
        Assert.Equal("idle", agent.GetState("main").State);
        Assert.Equal("error", agent.GetState("pr-1:EP-1").State);
    }

    [Fact]
    public async Task Cancel_kills_every_in_flight_run_and_returns_promptly()
    {
        _cli.Script(Hang());
        var agent = Agent();
        await agent.Start("job-a", _root, OnChange);
        await Task.Delay(1500);

        await agent.Cancel();

        Assert.Single(_cli.Invocations());
    }

    [Fact]
    public async Task A_run_body_replaces_the_subprocess_and_is_validated_like_one()
    {
        var agent = Agent(body: async (self, workspace, repoId, onOutput, token) =>
        {
            File.WriteAllText(Artifact(repoId), "{}");
            if (onOutput is not null) await onOutput(repoId, ["body ran"]);
            return new JobState("idle", null);
        });

        await agent.Start("job-a", _root, OnChange, OnOutput);
        var final = await Settled(agent);

        Assert.Equal(new JobState("idle", null), final);
        Assert.Empty(_cli.Invocations());
        Assert.Contains("body ran", _pushed);
    }

    [Fact]
    public async Task A_run_body_that_leaves_no_valid_artifact_reports_the_invalid_error()
    {
        var agent = Agent(body: (self, workspace, repoId, onOutput, token) => Task.FromResult(new JobState("idle", null)));

        await agent.Start("job-a", _root, OnChange);
        var final = await Settled(agent);

        Assert.Equal(new JobState("error", "no valid artifact"), final);
    }

    [Fact]
    public async Task The_item_half_of_a_composite_key_names_the_artifact()
    {
        Assert.Equal("EP-4", SkillAgent.ItemFromKey("main:EP-4"));
        Assert.Equal("main", SkillAgent.ItemFromKey("main"));
        await Task.CompletedTask;
    }
}
