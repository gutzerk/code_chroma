using System.Diagnostics;
using System.Text;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Agents;

/// <summary>A git worktree command failed; the message carries git's own stderr (bridge/errors.py: 409).</summary>
public class WorktreeException(string message) : BridgeException(409, message);

/// <summary>A network-touching git command could not run, hung, or exited non-zero (409).</summary>
public sealed class GitLongException(string reason, string message) : BridgeException(409, message)
{
    public const string NotRunnable = "not-runnable";
    public const string TimedOut = "timed-out";
    public const string Failed = "failed";

    public string Reason { get; } = reason;
}

/// <summary>Creating the PR failed; the message is git's or gh's own, shown to the user verbatim (409).</summary>
public sealed class PublishException(string message) : BridgeException(409, message);

/// <summary>The agent process could not be started; the message is shown to the user verbatim (409).</summary>
public sealed class AgentStartException(string message) : BridgeException(409, message);

/// <summary>Adds patterns to a repository's info/exclude: local, untracked, shared across worktrees, idempotent.</summary>
public static class GitExclude
{
    public static bool Ensure(string cwd, params string[] patterns)
    {
        var resolved = GitRunner.Run(cwd, "rev-parse", "--git-path", "info/exclude")?.Trim();
        if (string.IsNullOrEmpty(resolved)) return false;
        var path = Path.IsPathRooted(resolved) ? resolved : Path.GetFullPath(Path.Combine(cwd, resolved));
        try
        {
            var existing = File.Exists(path) ? File.ReadAllLines(path) : [];
            var missing = patterns.Where(p => !existing.Contains(p)).ToArray();
            if (missing.Length == 0) return true;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var prefix = existing.Length == 0 || existing[^1] == "" ? "" : "\n";
            File.AppendAllText(path, prefix + string.Join("\n", missing) + "\n");
            return true;
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }
}

/// <summary>git for the commands that talk to a network, where the short read timeout is wrong and a credential prompt would wedge it.</summary>
public static class GitLong
{
    public const string TimeoutEnv = "codechroma_GIT_LONG_TIMEOUT_SECONDS";

    public static int TimeoutSeconds()
    {
        var raw = Environment.GetEnvironmentVariable(TimeoutEnv)?.Trim();
        return int.TryParse(raw, out var value) && value > 0 ? value : BridgeLimits.GitLongTimeoutSeconds;
    }

    /// <summary>stdout of a network-touching git command; throws <see cref="GitLongException"/> with a reason on failure.</summary>
    public static string Run(string cwd, params string[] args)
    {
        var limit = TimeoutSeconds();
        var info = new ProcessStartInfo("git")
        {
            WorkingDirectory = cwd,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        info.Environment["GIT_TERMINAL_PROMPT"] = "0";
        info.Environment["GIT_ASKPASS"] = "echo";
        info.Environment["SSH_ASKPASS"] = "echo";
        info.Environment["SSH_ASKPASS_REQUIRE"] = "never";
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("GIT_SSH_COMMAND"))) info.Environment["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes";
        Process process;
        try { process = Process.Start(info)!; }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            throw new GitLongException(GitLongException.NotRunnable, $"git could not be run: {error.Message}");
        }
        using (process)
        {
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(TimeSpan.FromSeconds(limit)))
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                throw new GitLongException(GitLongException.TimedOut, $"git {args[0]} timed out after {limit}s");
            }
            if (process.ExitCode != 0)
            {
                var detail = (stderr.GetAwaiter().GetResult() is { Length: > 0 } e ? e : stdout.GetAwaiter().GetResult()).Trim();
                throw new GitLongException(GitLongException.Failed, detail.Length > 0 ? detail : $"git {args[0]} exited {process.ExitCode}");
            }
            return stdout.GetAwaiter().GetResult();
        }
    }
}

/// <summary>The GitHub CLI in a checkout; null when it fails, is missing or hangs.</summary>
public static class Gh
{
    public const int TimeoutSeconds = 60;

    public static bool Available => CliLocator.Find("gh") is not null;

    public static string? Run(string cwd, params string[] args) => Execute(cwd, args, out _);

    /// <summary>Runs `gh` without prompts or stdin; null on failure, with stderr (or the reason) in <paramref name="error"/>.</summary>
    public static string? Execute(string cwd, string[] args, out string error)
    {
        error = "";
        var binary = CliLocator.Find("gh");
        if (binary is null)
        {
            error = "gh was not found";
            return null;
        }
        var info = new ProcessStartInfo(binary)
        {
            WorkingDirectory = cwd,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        info.Environment["GH_PROMPT_DISABLED"] = "1";
        foreach (var arg in args) info.ArgumentList.Add(arg);
        try
        {
            using var process = Process.Start(info)!;
            process.StandardInput.Close();
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(TimeSpan.FromSeconds(TimeoutSeconds)))
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                error = "gh timed out";
                return null;
            }
            error = stderr.GetAwaiter().GetResult();
            return process.ExitCode == 0 ? stdout.GetAwaiter().GetResult() : null;
        }
        catch (Exception failure) when (failure is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            error = failure.Message;
            return null;
        }
    }
}
