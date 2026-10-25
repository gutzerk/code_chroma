using System.ComponentModel;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace CodeChroma.Shell;

public static partial class RepositoryClone
{
    [GeneratedRegex(@"^[\w.-]+@[\w.-]+:[^\s]+$")]
    private static partial Regex ScpAddress();

    public static string SuggestedName(string remote)
    {
        var path = remote.Trim().TrimEnd('/', '\\');
        if (Uri.TryCreate(path, UriKind.Absolute, out var uri) && !uri.IsFile) path = uri.AbsolutePath.TrimEnd('/');
        var name = path.Split(['/', '\\', ':']).Last();
        return name.EndsWith(".git", StringComparison.OrdinalIgnoreCase) ? name[..^4] : name;
    }

    public static string? ValidateRemote(string remote)
    {
        var value = remote.Trim();
        if (value.Length == 0) return "Enter a repository URL.";
        if (value.Any(char.IsControl) || value.StartsWith('-')) return "Enter a valid repository URL.";
        if (Path.IsPathRooted(value) && Directory.Exists(value)) return null;
        if (ScpAddress().IsMatch(value)) return null;
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && uri.Scheme is "https" or "http" or "ssh" or "git"
            && uri.Host.Length > 0 && uri.AbsolutePath.Trim('/').Length > 0
            && uri.Query.Length == 0 && uri.Fragment.Length == 0 && !uri.UserInfo.Contains(':')) return null;
        return "Use an HTTPS or SSH repository URL, such as https://github.com/owner/repo.git or git@github.com:owner/repo.git. Use your configured Git credentials instead of a password in the URL.";
    }

    public static async Task<string> CloneAsync(string remote, string parentDir, string name, IProgress<string>? progress = null, CancellationToken cancellationToken = default)
    {
        if (ValidateRemote(remote) is { } remoteProblem) throw new InvalidOperationException(remoteProblem);
        if (NewProject.Validate(name) is { } nameProblem) throw new InvalidOperationException(nameProblem);
        if (!Directory.Exists(parentDir)) throw new InvalidOperationException("Choose an existing destination folder.");
        var parent = Path.GetFullPath(parentDir);
        var destination = Path.Combine(parent, name.Trim());
        if (Directory.Exists(destination) || File.Exists(destination)) throw new InvalidOperationException($"{destination} already exists. Choose another project name.");
        cancellationToken.ThrowIfCancellationRequested();
        var staging = Path.Combine(parent, $".codechroma-clone-{Guid.NewGuid():N}");
        try
        {
            await RunGitCloneAsync(remote.Trim(), parent, staging, progress, cancellationToken).ConfigureAwait(false);
            Directory.Move(staging, destination);
            return destination;
        }
        finally { RemoveStagingDirectory(staging); }
    }

    private static async Task RunGitCloneAsync(string remote, string parent, string staging, IProgress<string>? progress, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo("git")
        {
            WorkingDirectory = parent,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var arg in new[] { "clone", "--progress", "--", remote, staging }) start.ArgumentList.Add(arg);
        start.Environment["GIT_TERMINAL_PROMPT"] = "0";
        start.Environment["GCM_INTERACTIVE"] = "Never";
        try
        {
            if (!start.Environment.ContainsKey("GIT_SSH_COMMAND") && !start.Environment.ContainsKey("GIT_SSH")
                && !await HasConfiguredSshCommandAsync(parent, cancellationToken).ConfigureAwait(false))
                start.Environment["GIT_SSH_COMMAND"] = "ssh -oBatchMode=yes";
            using var git = Process.Start(start) ?? throw new InvalidOperationException("Could not start Git.");
            var errors = new Queue<string>();
            var stdout = DrainAsync(git.StandardOutput, null, progress);
            var stderr = DrainAsync(git.StandardError, errors, progress);
            try { await WaitForGitExitAsync(git, cancellationToken).ConfigureAwait(false); }
            finally { await Task.WhenAll(stdout, stderr).ConfigureAwait(false); }
            cancellationToken.ThrowIfCancellationRequested();
            if (git.ExitCode != 0) throw new InvalidOperationException($"Could not clone the repository. Check the URL, network connection, and your Git credentials.\n{string.Join('\n', errors)}");
        }
        catch (Win32Exception e) { throw new InvalidOperationException("Git could not be started. Install Git and make sure it is available on PATH.", e); }
    }

    private static async Task<bool> HasConfiguredSshCommandAsync(string parent, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo("git")
        {
            WorkingDirectory = parent, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
        };
        foreach (var arg in new[] { "config", "--get", "core.sshCommand" }) start.ArgumentList.Add(arg);
        using var git = Process.Start(start) ?? throw new InvalidOperationException("Could not start Git.");
        var output = git.StandardOutput.ReadToEndAsync();
        var error = git.StandardError.ReadToEndAsync();
        try { await WaitForGitExitAsync(git, cancellationToken).ConfigureAwait(false); }
        finally { await Task.WhenAll(output, error).ConfigureAwait(false); }
        if (git.ExitCode is not (0 or 1)) throw new InvalidOperationException($"Could not read Git SSH configuration.\n{await error.ConfigureAwait(false)}");
        return git.ExitCode == 0;
    }

    private static async Task WaitForGitExitAsync(Process git, CancellationToken cancellationToken)
    {
        try { await git.WaitForExitAsync(cancellationToken).ConfigureAwait(false); }
        catch (OperationCanceledException)
        {
            try { git.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            await git.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
            throw;
        }
    }

    private static void RemoveStagingDirectory(string staging)
    {
        if (!Directory.Exists(staging)) return;
        try
        {
            foreach (var file in Directory.EnumerateFiles(staging, "*", SearchOption.AllDirectories)) File.SetAttributes(file, FileAttributes.Normal);
            Directory.Delete(staging, recursive: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    private static async Task DrainAsync(StreamReader reader, Queue<string>? tail, IProgress<string>? progress)
    {
        while (await reader.ReadLineAsync().ConfigureAwait(false) is { } line)
        {
            if (tail is not null)
            {
                tail.Enqueue(line.Length > 1000 ? line[..1000] : line);
                if (tail.Count > 5) tail.Dequeue();
            }
            progress?.Report(line.Length > 300 ? line[..300] : line);
        }
    }
}
