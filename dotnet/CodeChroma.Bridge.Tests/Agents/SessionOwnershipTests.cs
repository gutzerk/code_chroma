using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Tests.Support;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CodeChroma.Bridge.Tests.Agents;

[CollectionDefinition("Session ownership", DisableParallelization = true)]
public sealed class SessionOwnershipCollection;

[Collection("Session ownership")]
public sealed class SessionOwnershipTests
{
    private static StringContent Body(string json) => new(json, Encoding.UTF8, "application/json");

    private static TerminalAgents Terminal(string root)
    {
        var paths = UserPaths.Under(root);
        var providers = new ProviderStore(paths);
        return new TerminalAgents(paths, providers, new CallSiteStore(paths, providers));
    }

    [Theory]
    [InlineData("claude", false)]
    [InlineData("claude", true)]
    [InlineData("agent", false)]
    public void Fresh_normal_bare_and_provider_agents_receive_owned_ids(string kind, bool bare)
    {
        using var repo = new GitSandbox();
        var id = Guid.NewGuid().ToString();
        var file = AgentSessionOwnership.FileFor(repo.Root, Guid.NewGuid().ToString());
        var launch = Terminal(repo.Root).Resolve(kind, initialPrompt: "task", bare: bare, newSessionId: id, sessionTrackingFile: file)!;

        var argv = launch.Argv.ToList();
        Assert.Equal(id, argv[argv.IndexOf("--session-id") + 1]);
        Assert.Equal(file, launch.Env[AgentSessionOwnership.FileEnv]);
        Assert.Equal(id, launch.Env[AgentSessionOwnership.InitialIdEnv]);
        Assert.Contains("SessionStart", argv[argv.IndexOf("--settings") + 1]);
    }

    [Fact]
    public void A_resume_keeps_its_id_and_a_fork_gets_a_separate_owned_id()
    {
        using var repo = new GitSandbox();
        var terminal = Terminal(repo.Root);
        var id = Guid.NewGuid().ToString();
        var resumed = terminal.Resolve("claude", "source", newSessionId: id, sessionTrackingFile: "owned.json")!;
        var forked = terminal.Resolve("claude", "source", forkSession: true, newSessionId: id, sessionTrackingFile: "fork.json")!;

        Assert.DoesNotContain("--session-id", resumed.Argv);
        Assert.Equal("source", resumed.Env[AgentSessionOwnership.InitialIdEnv]);
        Assert.Contains("--fork-session", forked.Argv);
        Assert.Equal(id, forked.Env[AgentSessionOwnership.InitialIdEnv]);
        Assert.Equal(["--resume", "source"], forked.Argv.TakeLast(2));
    }

    [Fact]
    public void Shells_and_alternative_clis_do_not_receive_Claude_session_flags()
    {
        using var repo = new GitSandbox();
        var terminal = Terminal(repo.Root);
        var paths = UserPaths.Under(repo.Root);
        JsonFile.Write(paths.Assistant, new JsonObject { ["cli"] = "codex" });
        foreach (var kind in new[] { "shell", "claude", "agent" })
        {
            var launch = terminal.Resolve(kind, newSessionId: Guid.NewGuid().ToString(), sessionTrackingFile: "owned.json")!;
            Assert.DoesNotContain("--session-id", launch.Argv);
            Assert.DoesNotContain("--settings", launch.Argv);
            Assert.False(launch.Env.ContainsKey(AgentSessionOwnership.FileEnv));
        }
    }

    [Fact]
    public void Newer_external_transcripts_cannot_replace_an_owned_session_or_supply_a_legacy_id()
    {
        using var repo = new GitSandbox();
        var manager = new AgentManager(repo.Root);
        var owned = manager.Create("owner", attachTo: "main");
        var legacy = manager.Create("legacy", attachTo: "main");
        owned.SessionId = Guid.NewGuid().ToString();
        manager.Save();
        var oldConfig = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
        var config = repo.Sibling("claude");
        var project = Path.Combine(config, "projects", "same-worktree");
        Directory.CreateDirectory(project);
        File.WriteAllText(Path.Combine(project, "external.jsonl"), new JsonObject { ["cwd"] = repo.Root, ["sessionId"] = "external" }.ToJsonString());
        Environment.SetEnvironmentVariable("CLAUDE_CONFIG_DIR", config);
        try
        {
            Assert.Equal(owned.SessionId, manager.CaptureSessionId(owned.Id));
            Assert.Null(manager.CaptureSessionId(legacy.Id));
            Assert.Equal(owned.SessionId, new AgentManager(repo.Root).CaptureSessionId(owned.Id));
        }
        finally { Environment.SetEnvironmentVariable("CLAUDE_CONFIG_DIR", oldConfig); }
    }

    [Fact]
    public void Clear_and_resume_events_update_only_the_process_owned_file_and_survive_reload()
    {
        using var repo = new GitSandbox();
        var manager = new AgentManager(repo.Root);
        var record = manager.Create("owner", attachTo: "main");
        var sibling = manager.Create("sibling", attachTo: "main");
        record.SessionId = Guid.NewGuid().ToString();
        record.SessionTrackingId = Guid.NewGuid().ToString();
        manager.Save();
        var file = AgentSessionOwnership.FileFor(repo.Root, record.SessionTrackingId);
        foreach (var source in new[] { "clear", "resume" })
        {
            var id = Guid.NewGuid().ToString();
            AgentSessionOwnership.Record(new StringReader(new JsonObject { ["session_id"] = id, ["source"] = source }.ToJsonString()), file);
            Assert.Equal(id, new AgentManager(repo.Root).CaptureSessionId(record.Id));
            Assert.Null(manager.CaptureSessionId(sibling.Id));
        }
        AgentSessionOwnership.Record(new StringReader("invalid JSON"), file);
        Assert.NotNull(new AgentManager(repo.Root).CaptureSessionId(record.Id));
    }

    [Fact]
    public async Task The_generated_hook_command_records_stdin_without_starting_a_server()
    {
        using var repo = new GitSandbox();
        var file = AgentSessionOwnership.FileFor(repo.Root, Guid.NewGuid().ToString());
        var id = Guid.NewGuid().ToString();
        var hook = JsonNode.Parse(AgentSessionOwnership.HookSettings())!["hooks"]!["SessionStart"]![0]!["hooks"]![0]!;
        var windows = OperatingSystem.IsWindows();
        var info = new ProcessStartInfo(windows ? "powershell.exe" : "/bin/sh") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        if (windows)
        {
            Assert.Equal("powershell", (string?)hook["shell"]);
            info.ArgumentList.Add("-NoProfile");
            info.ArgumentList.Add("-NonInteractive");
        }
        info.ArgumentList.Add(windows ? "-Command" : "-c");
        info.ArgumentList.Add((string)hook["command"]!);
        info.Environment[AgentSessionOwnership.FileEnv] = file;
        using var helper = Process.Start(info)!;
        await helper.StandardInput.WriteAsync(new JsonObject { ["session_id"] = id }.ToJsonString());
        helper.StandardInput.Close();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        await helper.WaitForExitAsync(timeout.Token);
        Assert.True(helper.ExitCode == 0, await helper.StandardError.ReadToEndAsync());
        Assert.Equal(id, Json.Str(JsonFile.LoadObject(file)["session_id"]));
    }

    [Fact]
    public async Task Start_is_idempotent_and_restart_resumes_the_latest_owned_conversation()
    {
        using var cli = new FakeCliHarness();
        cli.Script(FakeCliHarness.Hang());
        using var host = new BridgeHost();
        var paths = host.Factory.Services.GetRequiredService<UserPaths>();
        JsonFile.Write(paths.Runtime, new JsonObject { ["cli_paths"] = new JsonObject { ["claude"] = cli.ExePath } });
        await host.Client.PostAsync("/agents", Body("""{"title":"runner","attach_to":"main"}"""));
        var started = await host.Client.PostAsync("/agents/runner/start", Body("{}"));
        Assert.True(started.IsSuccessStatusCode, await started.Content.ReadAsStringAsync());
        var first = JsonNode.Parse(await started.Content.ReadAsStringAsync())!;
        Assert.True(Guid.TryParse((string?)first["session_id"], out _));
        var sessions = host.Factory.Services.GetRequiredService<AgentSessionRegistry>();
        var actual = sessions.Get("runner")!;
        var second = await host.Client.PostAsync("/agents/runner/start", Body("{}"));
        Assert.True(second.IsSuccessStatusCode, await second.Content.ReadAsStringAsync());
        Assert.Equal((string?)first["session_id"], (string?)JsonNode.Parse(await second.Content.ReadAsStringAsync())!["session_id"]);
        Assert.Same(actual, sessions.Get("runner"));
        Assert.Equal((string?)first["session_id"], new AgentManager(host.Root).Get("runner").SessionId);

        var clearedId = Guid.NewGuid().ToString();
        AgentSessionOwnership.Record(new StringReader(new JsonObject { ["session_id"] = clearedId }.ToJsonString()), actual.SessionTrackingFile);
        await host.Client.PostAsync("/agents", Body("""{"title":"sibling","attach_to":"main"}"""));
        var runtime = host.Factory.Services.GetServices<IHostedService>().OfType<AgentRuntime>().Single();
        await runtime.StopAsync(CancellationToken.None);
        await runtime.StartAsync(CancellationToken.None);
        await runtime.StartedAsync(CancellationToken.None);
        var resumed = sessions.Get("runner")!;
        Assert.Equal(["--resume", clearedId], resumed.Argv.TakeLast(2));
        Assert.DoesNotContain("--session-id", resumed.Argv);
        Assert.NotEqual(actual.SessionTrackingFile, resumed.SessionTrackingFile);
        var sibling = sessions.Get("sibling")!;
        Assert.DoesNotContain("--resume", sibling.Argv);
        Assert.Contains("--session-id", sibling.Argv);
        Assert.True(Guid.TryParse(sibling.InitialSessionId, out _));
        Assert.NotEqual(clearedId, sibling.InitialSessionId);
        Assert.NotEqual(resumed.SessionTrackingFile, sibling.SessionTrackingFile);
        // A late event from the old process must not overwrite the new launch's session.
        AgentSessionOwnership.Record(new StringReader(new JsonObject { ["session_id"] = Guid.NewGuid().ToString() }.ToJsonString()), actual.SessionTrackingFile);
        Assert.Equal(clearedId, host.Factory.Services.GetRequiredService<AgentManager>().CaptureSessionId("runner"));
    }
}
