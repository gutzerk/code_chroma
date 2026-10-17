using System.Text.Json;
using System.Text.Json.Nodes;

// A scripted stand-in for the claude/codex/kimi CLIs: replays fakecli.script.json (next to this binary).
// Steps: {"stdout": line} {"stderr": text} {"write": {"path", "text"}} {"sleep_ms": n} {"hang": true} {"exit": code}.
var directory = AppContext.BaseDirectory;
var script = JsonNode.Parse(File.ReadAllText(Path.Combine(directory, "fakecli.script.json")))!.AsObject();

var recorded = new JsonObject
{
    ["args"] = new JsonArray(args.Select(a => (JsonNode?)a).ToArray()),
    ["cwd"] = Directory.GetCurrentDirectory(),
    ["env"] = new JsonObject(
        (script["record_env"]?.AsArray() ?? []).Select(k => new KeyValuePair<string, JsonNode?>(k!.GetValue<string>(), Environment.GetEnvironmentVariable(k.GetValue<string>())))),
};
File.AppendAllText(Path.Combine(directory, "fakecli.invocations.jsonl"), recorded.ToJsonString() + "\n");

foreach (var node in script["steps"]?.AsArray() ?? [])
{
    var step = node!.AsObject();
    if (step["stdout"] is { } line) { Console.Out.WriteLine(line.GetValue<string>()); Console.Out.Flush(); }
    if (step["stderr"] is { } err) { Console.Error.Write(err.GetValue<string>()); Console.Error.Flush(); }
    if (step["write"] is JsonObject write)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(write["path"]!.GetValue<string>())!);
        File.WriteAllText(write["path"]!.GetValue<string>(), write["text"]!.GetValue<string>());
    }
    if (step["sleep_ms"] is { } ms) Thread.Sleep(ms.GetValue<int>());
    if (step["hang"] is not null) Thread.Sleep(TimeSpan.FromMinutes(2));
    if (step["exit"] is { } code) return code.GetValue<int>();
}
return 0;
