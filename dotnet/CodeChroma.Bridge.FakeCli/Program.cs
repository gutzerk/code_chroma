using System.Text.Json;
using System.Text.Json.Nodes;

// A scripted stand-in for the claude/codex/kimi CLIs: replays fakecli.script.json (next to this binary).
// Steps: {"stdout": line} {"stderr": text} {"write": {"path", "text"}} (relative paths resolve against the cwd){"sleep_ms": n} {"hang": true} {"exit": code}
// plus {"stdout_slow": {"lines": [..], "interval_ms": n}} and {"block_until_file": path} (waits up to 2 minutes for the file to exist).
// A script with "runs": [{"steps": [..]}, ..] replays runs[n] on the n-th launch (the last one repeats).
var directory = AppContext.BaseDirectory;
var script = JsonNode.Parse(File.ReadAllText(Path.Combine(directory, "fakecli.script.json")))!.AsObject();

var recorded = new JsonObject
{
    ["args"] = new JsonArray(args.Select(a => (JsonNode?)a).ToArray()),
    ["cwd"] = Directory.GetCurrentDirectory(),
    ["env"] = new JsonObject(
        (script["record_env"]?.AsArray() ?? []).Select(k => new KeyValuePair<string, JsonNode?>(k!.GetValue<string>(), Environment.GetEnvironmentVariable(k.GetValue<string>())))),
};
var invocationsPath = Path.Combine(directory, "fakecli.invocations.jsonl");
int launchIndex;
using (OpenExclusive(Path.Combine(directory, "fakecli.invocations.lock")))
{
    launchIndex = File.Exists(invocationsPath) ? File.ReadLines(invocationsPath).Count(l => l.Length > 0) : 0;
    File.AppendAllText(invocationsPath, recorded.ToJsonString() + "\n");
}
var steps = script["runs"] is JsonArray runs && runs.Count > 0 ? runs[Math.Min(launchIndex, runs.Count - 1)]!["steps"]?.AsArray() : script["steps"]?.AsArray();

foreach (var node in steps ?? [])
{
    var step = node!.AsObject();
    if (step["stdout"] is { } line) { Console.Out.WriteLine(line.GetValue<string>()); Console.Out.Flush(); }
    if (step["stderr"] is { } err) { Console.Error.Write(err.GetValue<string>()); Console.Error.Flush(); }
    if (step["write"] is JsonObject write)
    {
        var target = Path.GetFullPath(write["path"]!.GetValue<string>(), Directory.GetCurrentDirectory());
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.WriteAllText(target, write["text"]!.GetValue<string>());
    }
    if (step["stdout_slow"] is JsonObject slow)
    {
        foreach (var item in slow["lines"]!.AsArray())
        {
            Console.Out.WriteLine(item!.GetValue<string>());
            Console.Out.Flush();
            Thread.Sleep(slow["interval_ms"]?.GetValue<int>() ?? 100);
        }
    }
    if (step["block_until_file"] is { } gate)
    {
        var until = DateTime.UtcNow.AddMinutes(2);
        while (!File.Exists(gate.GetValue<string>()) && DateTime.UtcNow < until) Thread.Sleep(25);
    }
    if (step["sleep_ms"] is { } ms) Thread.Sleep(ms.GetValue<int>());
    if (step["hang"] is not null) Thread.Sleep(TimeSpan.FromMinutes(2));
    if (step["exit"] is { } code) return code.GetValue<int>();
}
return 0;

static FileStream OpenExclusive(string path)
{
    while (true)
    {
        try { return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { Thread.Sleep(10); }
    }
}
