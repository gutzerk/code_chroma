using System.Diagnostics;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Stores;

/// <summary>Whether a CLI adapter is signed in, via its own status command; null when it can't be told (mirrors llm/cli_auth.py).</summary>
public static class CliAuth
{
    private static readonly Dictionary<string, string[]> StatusArgs = new() { ["claude"] = ["auth", "status"], ["codex"] = ["login", "status"] };

    public static bool? SignedIn(string adapter, RuntimeEnvironment runtime)
    {
        if (!StatusArgs.TryGetValue(adapter, out var args)) return null;
        RuntimeCli cli;
        try { cli = runtime.Resolve(adapter); }
        catch (CliLookupException) { return null; }
        var info = new ProcessStartInfo(cli.Executable) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, CreateNoWindow = true };
        foreach (var argument in args) info.ArgumentList.Add(argument);
        info.Environment.Clear();
        foreach (var (name, value) in cli.Env) info.Environment[name] = value;
        try
        {
            using var process = Process.Start(info)!;
            process.StandardInput.Close();
            var stdout = process.StandardOutput.ReadToEndAsync();
            _ = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(TimeSpan.FromSeconds(8)))
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                return null;
            }
            if (process.ExitCode != 0) return false;
            if (!stdout.Wait(TimeSpan.FromSeconds(2))) return true;
            try { return (JsonNode.Parse(stdout.Result) as JsonObject)?["loggedIn"]?.GetValue<bool>() ?? true; }
            catch (Exception ex) when (ex is System.Text.Json.JsonException or InvalidOperationException) { return true; }
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }
}
