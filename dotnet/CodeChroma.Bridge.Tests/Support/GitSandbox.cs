using System.Diagnostics;

namespace CodeChroma.Bridge.Tests.Support;

/// <summary>A throwaway directory, optionally a real git repository with one commit, deleted (read-only files included) on dispose.</summary>
public sealed class GitSandbox : IDisposable
{
    private readonly string _base;

    public GitSandbox(bool initGit = true, bool commit = true)
    {
        _base = Path.Combine(Path.GetTempPath(), "cc-git-" + Guid.NewGuid().ToString("N")[..10]);
        Root = Path.Combine(_base, "project");
        Directory.CreateDirectory(Root);
        File.WriteAllText(Path.Combine(Root, "app.py"), "value = 1\n");
        if (!initGit) return;
        Git("init", "-q");
        Git("config", "user.email", "test@example.com");
        Git("config", "user.name", "Test");
        Git("config", "core.autocrlf", "false");
        Git("checkout", "-q", "-b", "main");
        if (!commit) return;
        Git("add", "-A");
        Git("commit", "-q", "-m", "initial");
    }

    public string Root { get; }

    /// <summary>A sibling directory of the project, for worktrees and remotes that must live outside it.</summary>
    public string Sibling(string name)
    {
        var path = Path.Combine(_base, name);
        Directory.CreateDirectory(path);
        return path;
    }

    public string Git(params string[] args) => GitIn(Root, args);

    public static string GitIn(string cwd, params string[] args)
    {
        var info = new ProcessStartInfo("git") { WorkingDirectory = cwd, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        using var process = Process.Start(info)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        process.WaitForExit();
        if (process.ExitCode != 0) throw new InvalidOperationException($"git {string.Join(' ', args)}: {stderr.GetAwaiter().GetResult()}");
        return stdout.GetAwaiter().GetResult();
    }

    public string Write(string relative, string text)
    {
        var path = Path.Combine(Root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
        return path;
    }

    public void CommitAll(string message)
    {
        Git("add", "-A");
        Git("commit", "-q", "-m", message);
    }

    public void Dispose()
    {
        try
        {
            if (!Directory.Exists(_base)) return;
            foreach (var file in Directory.EnumerateFiles(_base, "*", SearchOption.AllDirectories))
                File.SetAttributes(file, FileAttributes.Normal);
            Directory.Delete(_base, recursive: true);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
