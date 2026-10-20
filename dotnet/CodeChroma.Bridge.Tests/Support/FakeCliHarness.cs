using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Tests.Support;

/// <summary>A scripted claude stand-in in a temp directory: copies the FakeCli build, renames it, and records invocations.</summary>
public sealed class FakeCliHarness : IDisposable
{
    public string Directory { get; } = Path.Combine(Path.GetTempPath(), "cc-fakecli-" + Guid.NewGuid().ToString("N")[..8]);

    public string ExePath { get; }

    public FakeCliHarness(string binaryName = "claude")
    {
        var source = FindBuildOutput();
        System.IO.Directory.CreateDirectory(Directory);
        foreach (var file in System.IO.Directory.GetFiles(source)) File.Copy(file, Path.Combine(Directory, Path.GetFileName(file)));
        var apphost = Path.Combine(Directory, "CodeChroma.Bridge.FakeCli" + (OperatingSystem.IsWindows() ? ".exe" : ""));
        ExePath = Path.Combine(Directory, binaryName + (OperatingSystem.IsWindows() ? ".exe" : ""));
        File.Move(apphost, ExePath);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(ExePath, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }

    private static string FindBuildOutput()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar));
        var framework = current.Name;
        var configuration = current.Parent!.Name;
        var dotnet = current.Parent.Parent!.Parent!.Parent!;
        return Path.Combine(dotnet.FullName, "CodeChroma.Bridge.FakeCli", "bin", configuration, framework);
    }

    /// <summary>Replaces the script the fake CLI replays on its next launch.</summary>
    public void Script(params JsonObject[] steps) => Script(null, steps);

    public void Script(string[]? recordEnv, params JsonObject[] steps) =>
        File.WriteAllText(Path.Combine(Directory, "fakecli.script.json"), new JsonObject
        {
            ["record_env"] = new JsonArray((recordEnv ?? []).Select(k => (JsonNode?)k).ToArray()),
            ["steps"] = new JsonArray(steps.Select(s => (JsonNode?)s).ToArray()),
        }.ToJsonString());

    /// <summary>Every launch so far: {args, cwd, env}.</summary>
    public List<JsonObject> Invocations()
    {
        var path = Path.Combine(Directory, "fakecli.invocations.jsonl");
        return File.Exists(path) ? File.ReadAllLines(path).Where(l => l.Length > 0).Select(l => JsonNode.Parse(l)!.AsObject()).ToList() : [];
    }

    public static JsonObject Stdout(string line) => new() { ["stdout"] = line };

    public static JsonObject Stderr(string text) => new() { ["stderr"] = text };

    public static JsonObject Write(string path, string text) => new() { ["write"] = new JsonObject { ["path"] = path, ["text"] = text } };

    public static JsonObject BlockUntilFile(string path) => new() { ["block_until_file"] = path };

    public static JsonObject StdoutSlow(int intervalMs, params string[] lines) =>
        new() { ["stdout_slow"] = new JsonObject { ["interval_ms"] = intervalMs, ["lines"] = new JsonArray(lines.Select(l => (JsonNode?)l).ToArray()) } };

    /// <summary>Replays runs[n] on the n-th launch (the last repeats), so each workflow step can behave differently.</summary>
    public void ScriptRuns(params JsonObject[][] runs) =>
        File.WriteAllText(Path.Combine(Directory, "fakecli.script.json"), new JsonObject
        {
            ["runs"] = new JsonArray(runs.Select(r => (JsonNode?)new JsonObject { ["steps"] = new JsonArray(r.Select(s => (JsonNode?)s).ToArray()) }).ToArray()),
        }.ToJsonString());

    public static JsonObject Exit(int code) => new() { ["exit"] = code };

    public static JsonObject Sleep(int milliseconds) => new() { ["sleep_ms"] = milliseconds };

    public static JsonObject Hang() => new() { ["hang"] = true };

    public static JsonObject ResultEvent(int durationMs = 1000) => Stdout($$"""{"type":"result","is_error":false,"duration_api_ms":{{durationMs}}}""");

    public void Dispose()
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try { System.IO.Directory.Delete(Directory, recursive: true); return; }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { Thread.Sleep(100); }
        }
    }
}
