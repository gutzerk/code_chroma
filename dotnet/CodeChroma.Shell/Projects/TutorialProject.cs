using System.Diagnostics;
using System.Reflection;
using System.Text.Json;

namespace CodeChroma.Shell;

/// <summary>The tutorial example project: written under app data, with one committed baseline so the tree carries a change.</summary>
public static class TutorialProject
{
    public const string ProjectName = "codechroma-tutorial";

    private static readonly Lazy<(Dictionary<string, string> Files, Dictionary<string, string> Baseline)> Data = new(Load);

    private static (Dictionary<string, string>, Dictionary<string, string>) Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("tutorial-project.json")!;
        using var doc = JsonDocument.Parse(stream);
        Dictionary<string, string> Read(string name) => doc.RootElement.GetProperty(name).EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString()!);
        return (Read("files"), Read("baseline"));
    }

    public static string Create(string parentDir)
    {
        var root = Path.Combine(parentDir, ProjectName);
        var (files, baseline) = Data.Value;
        WriteFiles(root, files);
        try
        {
            if (!Directory.Exists(Path.Combine(root, ".git"))) Git(root, "init");
            if (!HasCommit(root))
            {
                WriteFiles(root, baseline);
                Git(root, "add", "-A");
                Git(root, "-c", "user.name=CodeChroma Tutorial", "-c", "user.email=tutorial@codechroma.local", "commit", "-q", "-m", "Initial todo app");
                WriteFiles(root, files);
            }
        }
        catch (Exception)
        {
            // git missing: the project still opens; the bridge copes with a non-git folder.
        }
        return root;
    }

    private static void WriteFiles(string root, Dictionary<string, string> files)
    {
        foreach (var (relative, content) in files)
        {
            var target = Path.Combine(root, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, content);
        }
    }

    private static bool HasCommit(string root)
    {
        try { Git(root, "rev-parse", "--verify", "HEAD"); return true; }
        catch (InvalidOperationException) { return false; }
    }

    private static void Git(string root, params string[] args)
    {
        var info = new ProcessStartInfo("git") { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in args) info.ArgumentList.Add(a);
        using var git = Process.Start(info) ?? throw new InvalidOperationException("git did not start");
        git.StandardOutput.ReadToEnd();
        git.StandardError.ReadToEnd();
        git.WaitForExit(30_000);
        if (git.ExitCode != 0) throw new InvalidOperationException($"git {args[0]} failed");
    }
}
