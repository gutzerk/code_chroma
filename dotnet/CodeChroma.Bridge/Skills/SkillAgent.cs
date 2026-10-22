using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Skills;

public delegate Task OnChange(string key, JobState state);

public delegate Task OnOutput(string key, IReadOnlyList<string> lines);

/// <summary>Replaces the CLI subprocess entirely (the wiki-general pipeline); it reports the same job state shape.</summary>
public delegate Task<JobState> RunBody(SkillAgent agent, Workspace? workspace, string repoId, OnOutput? onOutput, CancellationToken token);

/// <summary>Tunables of the shared runner (config.py's SkillAgentConfig).</summary>
public sealed class SkillRunSettings
{
    public int OutputTailChars { get; init; } = 500;
    public int OutputLines { get; init; } = 300;
    public double FlushIntervalSeconds { get; init; } = 0.15;
}

/// <summary>Per-run extras of a CLI run: arguments appended to the argv and a gate awaited between output events.</summary>
public sealed record RunOptions(IReadOnlyList<string> ExtraArgs)
{
    public static RunOptions Default { get; } = new([]);

    public Func<CancellationToken, Task> PauseGate { get; init; } = static _ => Task.CompletedTask;

    /// <summary>Run without the CLI's ambient context, with a slash-command skill inlined (see <see cref="BareSkill"/>); workflow runs opt out.</summary>
    public bool Bare { get; init; } = true;

    public string BareTools { get; init; } = CliAdapters.DefaultBareTools;

    /// <summary>Pre-gathered architecture context (see <c>DiagramContext</c>) appended to the prompt; null leaves the agent to search itself.</summary>
    public string? Context { get; init; }
}

/// <summary>Per-kind timeouts and default model (config.py's SkillAgentTimeoutsConfig).</summary>
public static class SkillTimeouts
{
    public const string Model = "haiku";
    public const int Default = 600;

    private static readonly Dictionary<string, int> Seconds = new()
    {
        ["c1"] = 600, ["patterns"] = 600, ["impact-changes"] = 300, ["epic-brief"] = 300, ["custom"] = 600,
        ["canvas-chat"] = 180, ["wiki-general"] = 3600, ["workflow-step"] = 1800, ["workflow-chat"] = 300, ["wiki-general-update"] = 300,
    };

    public static int For(string kind) => Seconds.GetValueOrDefault(kind, Default);
}

/// <summary>One background skill-run kind: its call-site name, prompt, artifact location and validity check (null artifact: exit code 0 alone completes it).</summary>
public sealed record SkillAgentSpec(
    string Name,
    string? Prompt,
    string Model,
    Func<string, string, string>? Artifact,
    Func<JsonNode?, bool>? Validate,
    string TimeoutEnvVar,
    int DefaultTimeoutSeconds,
    string? InvalidError,
    RunBody? RunBody = null)
{
    /// <summary>A kind with no artifact to protect or validate.</summary>
    public static SkillAgentSpec NoArtifact(string name, string? prompt, string model, string timeoutEnvVar, int defaultTimeoutSeconds) =>
        new(name, prompt, model, null, null, timeoutEnvVar, defaultTimeoutSeconds, null);
}

/// <summary>
/// Runs a CodeChroma skill headlessly through a CLI, protecting the artifact it rewrites: the file is snapshotted
/// before the run and restored when it times out, exits non-zero, is cancelled or leaves an invalid file.
/// </summary>
public sealed class SkillAgent(SkillAgentSpec spec, CliResolver resolver, RuntimeEnvironment runtime, SkillRunSettings? settings = null)
{
    private readonly object _startGate = new();
    private static readonly JobState IdleState = new("idle", null);
    private readonly SkillRunSettings _settings = settings ?? new SkillRunSettings();
    private readonly ConcurrentDictionary<string, JobState> _jobs = new();
    private readonly ConcurrentDictionary<string, Run> _runs = new();
    private readonly ConcurrentDictionary<string, List<Process>> _jobProcs = new();
    private readonly ConcurrentDictionary<string, List<string>> _output = new();

    private sealed class Run
    {
        public TaskCompletionSource Done { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task Task => Done.Task;
        public required CancellationTokenSource Stop { get; init; }
        public Process? Process { get; set; }
    }

    public SkillAgentSpec Spec { get; } = spec;

    public string Name => Spec.Name;

    public JobState GetState(string repoId) => _jobs.GetValueOrDefault(repoId, IdleState);

    public List<string> GetOutput(string repoId)
    {
        if (!_output.TryGetValue(repoId, out var lines)) return [];
        lock (lines) return [.. lines];
    }

    /// <summary>The item half of a composite {repo_id}:{item} job key (a bare key is its own item).</summary>
    public static string ItemFromKey(string key) => key[(key.LastIndexOf(':') + 1)..];

    public int TimeoutSeconds()
    {
        var raw = Environment.GetEnvironmentVariable(Spec.TimeoutEnvVar)?.Trim();
        return int.TryParse(raw, out var value) && value > 0 ? value : Spec.DefaultTimeoutSeconds;
    }

    /// <summary>Starts a background run unless one is in flight; the workspace is only for a run body.</summary>
    public async Task<JobState> Start(string repoId, string repoRoot, OnChange onChange, OnOutput? onOutput = null, string? prompt = null, Workspace? workspace = null,
        RunOptions? options = null)
    {
        var state = new JobState("generating", null);
        var run = new Run { Stop = new CancellationTokenSource() };
        lock (_startGate)
        {
            if (AlreadyGenerating(repoId) is { } already) return already;
            _jobs[repoId] = state;
            _output[repoId] = [];
            _runs[repoId] = run;
        }
        CliResolution cli;
        RuntimeCli resolved;
        try
        {
            cli = resolver.Resolve(Spec.Name, Spec.Model);
            resolved = await Task.Run(() => runtime.Resolve(cli.Binary, cli.EnvOverrides));
        }
        catch (CliLookupException error)
        {
            _runs.TryRemove(new KeyValuePair<string, Run>(repoId, run));
            run.Done.TrySetResult();
            var failed = new JobState("error", error.Message);
            _jobs[repoId] = failed;
            await onChange(repoId, failed);
            return failed;
        }
        catch
        {
            _runs.TryRemove(new KeyValuePair<string, Run>(repoId, run));
            _jobs[repoId] = IdleState;
            run.Done.TrySetResult();
            throw;
        }
        var stop = run.Stop.Token;
        if (stop.IsCancellationRequested)
        {
            run.Done.TrySetResult();
            return GetState(repoId);
        }
        await onChange(repoId, state);
        _ = Task.Run(async () =>
        {
            try { await RunAsync(repoId, repoRoot, onChange, onOutput, prompt, cli, workspace, resolved, stop, options); }
            finally { run.Done.TrySetResult(); }
        });
        return state;
    }

    private JobState? AlreadyGenerating(string repoId) => _jobs.TryGetValue(repoId, out var current) && current.State == "generating" ? current : null;

    private async Task<JobState> BeginGenerating(string repoId, OnChange onChange)
    {
        var state = new JobState("generating", null);
        _jobs[repoId] = state;
        _output[repoId] = [];
        await onChange(repoId, state);
        return state;
    }

    /// <summary>The interactive-run counterpart of Start: the same generating flip with no subprocess.</summary>
    public async Task<JobState> MarkGenerating(string repoId, OnChange onChange) => AlreadyGenerating(repoId) ?? await BeginGenerating(repoId, onChange);

    public async Task<JobState> MarkDone(string repoId, OnChange onChange, string? error = null)
    {
        var state = error is not null ? new JobState("error", error) : IdleState;
        _jobs[repoId] = state;
        await onChange(repoId, state);
        return state;
    }

    /// <summary>Kills repo_id's run (restoring its pre-run artifact) and resets the job to idle.</summary>
    public async Task<JobState> Stop(string repoId)
    {
        await CancelJob(repoId);
        return _jobs[repoId] = IdleState;
    }

    private async Task CancelJob(string repoId)
    {
        if (!_runs.TryRemove(repoId, out var run)) { KillJobProcs(repoId); return; }
        await run.Stop.CancelAsync();
        KillProcess(run.Process);
        KillJobProcs(repoId);
        try { await run.Task; } catch (OperationCanceledException) { }
        KillProcess(run.Process);
    }

    public async Task Cancel()
    {
        foreach (var repoId in _runs.Keys.Concat(_jobProcs.Keys).Distinct().ToList()) await CancelJob(repoId);
    }

    /// <summary>Cancels and drops all of repo_id's state, including composite {repo_id}:* job keys.</summary>
    public async Task Forget(string repoId)
    {
        var prefix = repoId + ":";
        var keys = _jobs.Keys.Concat(_runs.Keys).Concat(_jobProcs.Keys).Concat(_output.Keys).Where(k => k == repoId || k.StartsWith(prefix, StringComparison.Ordinal)).Distinct().ToList();
        foreach (var key in keys)
        {
            await CancelJob(key);
            _jobs.TryRemove(key, out _);
            _output.TryRemove(key, out _);
        }
    }

    /// <summary>The CLI this call site resolves to right now, for a run body that spawns its own workers.</summary>
    public CliResolution ResolveCli() => resolver.Resolve(Spec.Name, Spec.Model);

    /// <summary>The runnable executable and environment for a resolved CLI; blocking, so call it off the request path.</summary>
    public RuntimeCli ResolveRuntime(CliResolution cli) => runtime.Resolve(cli.Binary, cli.EnvOverrides);

    /// <summary>Tells the runtime environment a launch failed, so its next resolve re-probes.</summary>
    public void ReportLaunchFailed(Exception error) => runtime.LaunchFailed(error);

    public void RegisterJobProc(string repoId, Process process)
    {
        var list = _jobProcs.GetOrAdd(repoId, _ => []);
        lock (list) list.Add(process);
    }

    public void UnregisterJobProc(string repoId, Process process)
    {
        if (_jobProcs.TryGetValue(repoId, out var list)) lock (list) list.Remove(process);
    }

    private void KillJobProcs(string repoId)
    {
        if (!_jobProcs.TryRemove(repoId, out var list)) return;
        lock (list) foreach (var process in list) KillProcess(process);
    }

    internal static void KillProcess(Process? process)
    {
        try
        {
            if (process is { HasExited: false }) process.Kill(entireProcessTree: true);
        }
        catch (Exception error) when (error is InvalidOperationException or Win32Exception) { }
    }

    public bool HasArtifact(string repoRoot, string repoId)
    {
        if (Spec.Artifact is null || Spec.Validate is null) return true;
        try
        {
            return Spec.Validate(JsonNode.Parse(File.ReadAllText(Spec.Artifact(repoRoot, repoId))));
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private async Task RunAsync(string repoId, string repoRoot, OnChange onChange, OnOutput? onOutput, string? prompt, CliResolution cli,
        Workspace? workspace, RuntimeCli resolved, CancellationToken stop, RunOptions? options)
    {
        JobState state;
        try
        {
            state = Spec.RunBody is not null
                ? await RunBody(repoId, repoRoot, workspace, onOutput, stop)
                : await RunCli(repoId, repoRoot, onOutput, prompt, cli, resolved, stop, options);
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested || !_runs.ContainsKey(repoId))
        {
            return;
        }
        catch (CliLaunchException error)
        {
            state = new JobState("error", error.Message);
        }
        catch (CliLookupException error)
        {
            state = new JobState("error", error.Message);
        }
        catch (Exception)
        {
            state = new JobState("error", "generation crashed unexpectedly");
        }
        _jobs[repoId] = state;
        await onChange(repoId, state);
    }

    private async Task<JobState> RunBody(string repoId, string repoRoot, Workspace? workspace, OnOutput? onOutput, CancellationToken stop)
    {
        var snapshot = Snapshot(repoRoot, repoId);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
        timeout.CancelAfter(TimeSpan.FromSeconds(TimeoutSeconds()));
        JobState result;
        try
        {
            result = await Spec.RunBody!(this, workspace, repoId, onOutput, timeout.Token);
        }
        catch (OperationCanceledException)
        {
            KillJobProcs(repoId);
            Restore(repoRoot, repoId, snapshot);
            if (stop.IsCancellationRequested) throw;
            return new JobState("error", "generation timed out");
        }
        if (result.State != "idle")
        {
            Restore(repoRoot, repoId, snapshot);
            return result;
        }
        if (HasArtifact(repoRoot, repoId)) return result;
        Restore(repoRoot, repoId, snapshot);
        return new JobState("error", Spec.InvalidError);
    }

    private async Task<JobState> RunCli(string repoId, string repoRoot, OnOutput? onOutput, string? prompt, CliResolution cli, RuntimeCli resolved, CancellationToken stop,
        RunOptions? options)
    {
        var snapshot = Snapshot(repoRoot, repoId);
        var adapter = CliAdapters.All[cli.AdapterKey];
        var env = new Dictionary<string, string>(resolved.Env);
        foreach (var (k, v) in cli.EnvOverrides) env[k] = v;
        env["codechroma_WORKSPACE_ID"] = repoId;
        var staticPrompt = prompt ?? Spec.Prompt ?? throw new InvalidOperationException("RunCli needs a prompt");
        // An explicit --model re-triggers the CLI rejection; omit it when ANTHROPIC_MODEL carries the model.
        var argvModel = cli.EnvOverrides.ContainsKey("ANTHROPIC_MODEL") ? "" : cli.Model;
        options ??= RunOptions.Default;
        using var promptFile = new PromptFile();
        var bareArgs = options.Bare && BareSkill.Enabled() ? adapter.BareArgs(options.BareTools) : [];
        if (bareArgs.Count > 0)
        {
            if (BareSkill.Compose(staticPrompt, repoRoot, repoId) is { } inlined) staticPrompt = inlined;
            else bareArgs = [];
        }
        if (!string.IsNullOrWhiteSpace(options.Context))
            staticPrompt += "\n\n## Pre-gathered context\n\nThis was selected from the repository's architecture map for this diagram. Start from it and open a file only to confirm a detail it does not settle.\n\n" + options.Context;
        staticPrompt = FitCommandLine(staticPrompt, repoRoot, promptFile);
        var argv = adapter.BuildArgv(resolved.Executable, staticPrompt, argvModel, env, [.. bareArgs, .. options.ExtraArgs]);
        var info = new ProcessStartInfo(argv[0])
        {
            WorkingDirectory = repoRoot, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
            RedirectStandardInput = true, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var argument in argv.Skip(1)) info.ArgumentList.Add(argument);
        info.Environment.Clear();
        foreach (var (k, v) in env) info.Environment[k] = v;

        using var debugLog = OpenDebugLog(repoId);
        Process process;
        try
        {
            process = Process.Start(info) ?? throw new Win32Exception("process did not start");
        }
        catch (Exception error) when (error is Win32Exception or IOException)
        {
            runtime.LaunchFailed(error);
            throw new CliLaunchException(resolved.LaunchError(error));
        }
        using (process)
        {
            if (_runs.TryGetValue(repoId, out var active)) active.Process = process;
            else
            {
                KillProcess(process);
                throw new OperationCanceledException(stop);
            }
            process.StandardInput.Close();
            var pending = new List<string>();
            var stderrTail = new StringBuilder();
            var buffer = _output.GetOrAdd(repoId, _ => []);
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stop);
            deadline.CancelAfter(TimeSpan.FromSeconds(TimeoutSeconds()));
            var gate = PausableDeadline(options.PauseGate, deadline);
            var readers = Task.WhenAll(ReadEvents(process, repoRoot, adapter, buffer, pending, debugLog, stop, gate), ReadTail(process, stderrTail, debugLog, stop));
            using var flusher = new CancellationTokenSource();
            var flushLoop = FlushLoop(repoId, pending, onOutput, flusher.Token, gate);
            var timedOut = false;
            try
            {
                await process.WaitForExitAsync(deadline.Token);
                await readers;
            }
            catch (OperationCanceledException)
            {
                KillProcess(process);
                await WaitQuietly(process);
                Restore(repoRoot, repoId, snapshot);
                if (stop.IsCancellationRequested) throw;
                timedOut = true;
            }
            finally
            {
                _runs.TryGetValue(repoId, out var current);
                if (current is not null) current.Process = null;
                await flusher.CancelAsync();
                try { await flushLoop; } catch (OperationCanceledException) { }
                await FlushOnce(repoId, pending, onOutput);
            }
            if (timedOut) return new JobState("error", "generation timed out");

            if (process.ExitCode != 0)
            {
                Restore(repoRoot, repoId, snapshot);
                return new JobState("error", FailureMessage(process.ExitCode, stderrTail.ToString(), GetOutput(repoId)));
            }
        }
        if (HasArtifact(repoRoot, repoId)) return IdleState;
        Restore(repoRoot, repoId, snapshot);
        return new JobState("error", Spec.InvalidError);
    }

    /// <summary>A pause gate that stops the run's timeout while it holds the reader and restarts the full timeout when it releases.</summary>
    private Func<CancellationToken, Task> PausableDeadline(Func<CancellationToken, Task> gate, CancellationTokenSource deadline) => async token =>
    {
        var wait = gate(token);
        if (wait.IsCompleted) { await wait; return; }
        deadline.CancelAfter(Timeout.InfiniteTimeSpan);
        await wait;
        deadline.CancelAfter(TimeSpan.FromSeconds(TimeoutSeconds()));
    };

    /// <summary>Windows caps a command line near 32k characters, so a long inlined prompt goes to a file the CLI is told to read first.</summary>
    private string FitCommandLine(string prompt, string repoRoot, PromptFile promptFile)
    {
        if (EscapedLength(prompt) <= MaxArgvPromptChars) return prompt;
        var directory = Path.Combine(repoRoot, ".codechroma", "prompts");
        Directory.CreateDirectory(directory);
        var file = promptFile.FilePath = Path.Combine(directory, $"{Spec.Name}-{Guid.NewGuid():N}.md");
        File.WriteAllText(file, prompt);
        var marker = prompt.LastIndexOf("\nTask: ", StringComparison.Ordinal);
        var task = marker < 0 ? "" : $"\n\n{prompt[(marker + 1)..]}";
        if (EscapedLength(task) > MaxArgvPromptChars) task = "";
        return $"Your complete instructions are in {file}. Read that file in full with your Read tool before anything else, then carry out its task.{task}";
    }

    /// <summary>A prompt's length once quoted into a Windows command line, where every quote and backslash may gain an escape.</summary>
    private static int EscapedLength(string text)
    {
        if (text.Length > MaxArgvPromptChars) return text.Length;
        var length = text.Length;
        foreach (var c in text)
            if (c is '"' or '\\') length++;
        return length;
    }

    private const int MaxArgvPromptChars = 20_000;

    /// <summary>The temporary file holding a long inlined prompt; removed when the run ends.</summary>
    private sealed class PromptFile : IDisposable
    {
        public string? FilePath { get; set; }

        public void Dispose()
        {
            if (FilePath is null) return;
            try { File.Delete(FilePath); } catch (IOException) { }
        }
    }

    internal static async Task WaitQuietly(Process process)
    {
        try { await process.WaitForExitAsync(); } catch (InvalidOperationException) { }
    }

    private async Task ReadEvents(Process process, string repoRoot, ICliAdapter adapter, List<string> buffer, List<string> pending, TextWriter? debugLog, CancellationToken token, Func<CancellationToken, Task> pauseGate)
    {
        while (await process.StandardOutput.ReadLineAsync(token) is { } raw)
        {
            DebugWrite(debugLog, raw + "\n");
            await pauseGate(token);
            var lines = adapter.ParseLine(raw, repoRoot);
            if (lines.Count == 0) continue;
            lock (buffer)
            {
                buffer.AddRange(lines);
                if (buffer.Count > _settings.OutputLines) buffer.RemoveRange(0, buffer.Count - _settings.OutputLines);
            }
            lock (pending) pending.AddRange(lines);
        }
    }

    private async Task ReadTail(Process process, StringBuilder tail, TextWriter? debugLog, CancellationToken token)
    {
        var chunk = new char[4096];
        int read;
        while ((read = await process.StandardError.ReadAsync(chunk.AsMemory(), token)) > 0)
        {
            tail.Append(chunk, 0, read);
            if (tail.Length > _settings.OutputTailChars) tail.Remove(0, tail.Length - _settings.OutputTailChars);
            DebugWrite(debugLog, new string(chunk, 0, read));
        }
    }

    private async Task FlushLoop(string repoId, List<string> pending, OnOutput? onOutput, CancellationToken token, Func<CancellationToken, Task> pauseGate)
    {
        while (true)
        {
            await Task.Delay(TimeSpan.FromSeconds(_settings.FlushIntervalSeconds), token);
            await pauseGate(token);
            await FlushOnce(repoId, pending, onOutput);
        }
    }

    /// <summary>Hands off whatever accumulated since the last tick; a push failure never breaks the run.</summary>
    private static async Task FlushOnce(string repoId, List<string> pending, OnOutput? onOutput)
    {
        string[] batch;
        lock (pending)
        {
            if (pending.Count == 0) return;
            batch = [.. pending];
            if (onOutput is null) { pending.Clear(); return; }
        }
        try
        {
            await onOutput!(repoId, batch);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // A broken socket must not fail the run; the lines are dropped like the Python runner does.
        }
        lock (pending) pending.RemoveRange(0, Math.Min(batch.Length, pending.Count));
    }

    /// <summary>The adapter's own error line beats stderr noise, which beats the raw exit code.</summary>
    private static string FailureMessage(int exitCode, string stderr, List<string> rendered)
    {
        var errorLine = rendered.AsEnumerable().Reverse().FirstOrDefault(l => l.StartsWith("✗ ", StringComparison.Ordinal) || l.StartsWith("  ↳ error: ", StringComparison.Ordinal));
        if (errorLine is not null) return errorLine;
        if (stderr.Trim() is { Length: > 0 } message) return message;
        var tail = string.Join("\n", rendered.TakeLast(3)).Trim();
        return tail.Length > 0 ? tail : $"claude exited {exitCode}";
    }

    /// <summary>Kept in memory, not a .bak file, so a failed run leaves nothing behind in the repo.</summary>
    private byte[]? Snapshot(string repoRoot, string repoId)
    {
        if (Spec.Artifact is null) return null;
        try
        {
            return File.ReadAllBytes(Spec.Artifact(repoRoot, repoId));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private void Restore(string repoRoot, string repoId, byte[]? snapshot)
    {
        if (Spec.Artifact is null) return;
        var path = Spec.Artifact(repoRoot, repoId);
        try
        {
            if (snapshot is null)
            {
                File.Delete(path);
                return;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, snapshot);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    internal StreamWriter? OpenDebugLog(string repoId)
    {
        var dir = Environment.GetEnvironmentVariable("codechroma_SKILL_LOG_DIR")?.Trim();
        if (string.IsNullOrEmpty(dir)) return null;
        try
        {
            Directory.CreateDirectory(dir);
            return new StreamWriter(Path.Combine(dir, $"{Spec.Name}-{repoId.Replace('/', '_').Replace(':', '_')}-{DateTime.UtcNow:yyyyMMddTHHmmssZ}.log"), append: true, Encoding.UTF8);
        }
        catch (IOException)
        {
            return null;
        }
    }

    internal static void DebugWrite(TextWriter? log, string text)
    {
        if (log is null) return;
        try
        {
            lock (log) { log.Write(text); log.Flush(); }
        }
        catch (IOException) { }
    }
}
