using System.Diagnostics;
using System.Text;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>The one place a git subprocess is spawned; null when git could not run or exited non-zero.</summary>
public static class GitRunner
{
    public static string? Run(string cwd, TimeSpan? timeout, params string[] args)
    {
        var info = new ProcessStartInfo("git")
        {
            WorkingDirectory = cwd,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        try
        {
            using var process = Process.Start(info)!;
            var stdout = process.StandardOutput.ReadToEndAsync();
            _ = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(timeout ?? TimeSpan.FromSeconds(BridgeLimits.GitShortTimeoutSeconds)))
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                return null;
            }
            return process.ExitCode == 0 ? stdout.GetAwaiter().GetResult() : null;
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return null;
        }
    }

    public static string? Run(string cwd, params string[] args) => Run(cwd, null, args);

    /// <summary>Repo-relative paths from `git status --porcelain` output (renames report the new path).</summary>
    public static IEnumerable<string> PorcelainPaths(string status)
    {
        foreach (var line in status.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            if (line.Length < 4) continue;
            var path = line[3..].TrimEnd('\r');
            var arrow = path.IndexOf(" -> ", StringComparison.Ordinal);
            if (arrow >= 0) path = path[(arrow + 4)..];
            yield return Unquote(path);
        }
    }

    private static string Unquote(string path)
    {
        if (path.Length < 2 || path[0] != '"' || path[^1] != '"') return path;
        var bytes = new List<byte>();
        for (var i = 1; i < path.Length - 1; i++)
        {
            if (path[i] != '\\') { bytes.AddRange(Encoding.UTF8.GetBytes(path[i].ToString())); continue; }
            i++;
            if (char.IsDigit(path[i]) && i + 2 < path.Length)
            {
                bytes.Add(Convert.ToByte(path.Substring(i, 3), 8));
                i += 2;
            }
            else
            {
                bytes.Add((byte)(path[i] switch { 'n' => '\n', 't' => '\t', var c => c }));
            }
        }
        return Encoding.UTF8.GetString(bytes.ToArray());
    }
}
