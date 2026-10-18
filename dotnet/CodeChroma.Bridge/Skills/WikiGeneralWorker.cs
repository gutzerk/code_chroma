using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Skills;

/// <summary>The outcome of one worker job: parsed structured data, or an error message.</summary>
public sealed record WorkerResult(bool Ok, JsonObject? Data, string? Error);

/// <summary>Raised once, up front, when the selected CLI adapter has no minimal-context worker mode.</summary>
public sealed class UnsupportedAdapterException(string message) : Exception(message);

/// <summary>Tunables of the deterministic fan-out (config.py's WikiGeneralPipelineConfig).</summary>
public static class WikiGeneralPipelineSettings
{
    public const int WorkerConcurrency = 6;
    public const int JobTimeoutSeconds = 120;
    public const int MaxRetriesPerJob = 2;
}

/// <summary>One zero-tool CLI subprocess per wiki-general pipeline job, with bounded retries (wiki_general_worker.py).</summary>
public static class WikiGeneralWorker
{
    /// <summary>The explicit fail-clearly gate: never a silent fallback to a full-context call.</summary>
    public static ClaudeAdapter RequireMinimalContextSupport(ICliAdapter adapter, string binary) =>
        adapter as ClaudeAdapter ?? throw new UnsupportedAdapterException($"adapter '{binary}' does not support minimal-context workers");

    public static async Task<WorkerResult> Run(
        SkillAgent agent, string repoId, string repoRoot, ClaudeAdapter adapter, CliResolution cli, string model,
        string prompt, JsonObject schema, string jobLabel, CancellationToken token)
    {
        var result = new WorkerResult(false, null, "worker never ran");
        // One file for the whole job: every retry attempt appends to it, not a fresh file each time.
        using var debugLog = agent.OpenDebugLog($"{repoId}:{jobLabel}");
        for (var attempt = 0; attempt <= WikiGeneralPipelineSettings.MaxRetriesPerJob; attempt++)
        {
            result = await RunOnce(agent, repoId, repoRoot, adapter, cli, model, prompt, schema, attempt, debugLog, token);
            if (result.Ok) return result;
        }
        return result;
    }

    private static async Task<WorkerResult> RunOnce(
        SkillAgent agent, string repoId, string repoRoot, ClaudeAdapter adapter, CliResolution cli, string model,
        string prompt, JsonObject schema, int attempt, TextWriter? debugLog, CancellationToken token)
    {
        var runtime = await Task.Run(() => agent.ResolveRuntime(cli), token);
        var argv = adapter.BuildWorkerArgv(runtime.Executable, prompt, model, schema.ToJsonString());
        SkillAgent.DebugWrite(debugLog, $"=== attempt {attempt + 1}: {string.Join(' ', argv)}\n");
        var info = new ProcessStartInfo(argv[0])
        {
            WorkingDirectory = repoRoot, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
            RedirectStandardInput = true, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var argument in argv.Skip(1)) info.ArgumentList.Add(argument);
        info.Environment.Clear();
        foreach (var (k, v) in runtime.Env) info.Environment[k] = v;

        Process process;
        try
        {
            process = Process.Start(info) ?? throw new Win32Exception("process did not start");
        }
        catch (Exception error) when (error is Win32Exception or IOException)
        {
            agent.ReportLaunchFailed(error);
            throw new CliLaunchException(runtime.LaunchError(error));
        }
        using (process)
        {
            process.StandardInput.Close();
            agent.RegisterJobProc(repoId, process);
            var stdoutTask = process.StandardOutput.ReadToEndAsync(CancellationToken.None);
            var stderrTask = process.StandardError.ReadToEndAsync(CancellationToken.None);
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
            deadline.CancelAfter(TimeSpan.FromSeconds(WikiGeneralPipelineSettings.JobTimeoutSeconds));
            try
            {
                await process.WaitForExitAsync(deadline.Token);
            }
            catch (OperationCanceledException)
            {
                SkillAgent.KillProcess(process);
                await SkillAgent.WaitQuietly(process);
                if (token.IsCancellationRequested) throw;
                SkillAgent.DebugWrite(debugLog, "=== timed out\n");
                return new WorkerResult(false, null, "worker timed out");
            }
            finally
            {
                agent.UnregisterJobProc(repoId, process);
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            SkillAgent.DebugWrite(debugLog, stdout);
            SkillAgent.DebugWrite(debugLog, stderr);
            if (process.ExitCode != 0)
            {
                // stdout's own readable `result` beats stderr noise (e.g. an unrelated cosmetic warning).
                var message = adapter.ParseErrorMessage(stdout) ?? (stderr.Trim() is { Length: > 0 } text ? text : $"worker exited {process.ExitCode}");
                Console.Error.WriteLine($"{agent.Name}: worker job failed for {repoId}: {message}");
                return new WorkerResult(false, null, message);
            }
            return adapter.ParseStructuredOutput(stdout) is { } data
                ? new WorkerResult(true, data, null)
                : new WorkerResult(false, null, "worker returned no structured output");
        }
    }
}
