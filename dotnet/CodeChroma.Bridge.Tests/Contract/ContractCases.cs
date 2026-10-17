using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Tests.Contract;

public sealed record ContractCase(string Id, string Group, JsonObject Repo, string[] Requires, JsonArray Steps);

/// <summary>Loads tests/fixtures/bridge_contract/*.cases.json the same way tests/contract/bridge_contract.py does.</summary>
public static class ContractCases
{
    /// <summary>Capabilities this backend implements; cases needing others are listed, not run.</summary>
    public static readonly HashSet<string> Supported = Support.BridgeHost.RealEngine
        ? ["terminal-frames", "pty", "real-engine"]
        : ["terminal-frames", "pty"];

    public static string FixtureDir { get; } = FindFixtureDir();

    private static string FindFixtureDir()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "tests", "fixtures", "bridge_contract");
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new DirectoryNotFoundException("tests/fixtures/bridge_contract not found above " + AppContext.BaseDirectory);
    }

    public static IReadOnlyList<ContractCase> All { get; } = Load();

    public static IEnumerable<ContractCase> Runnable => All.Where(c => !c.Requires.Except(Supported).Any());

    public static IEnumerable<ContractCase> Unsupported => All.Where(c => c.Requires.Except(Supported).Any());

    public static IEnumerable<object[]> RunnableIds => Runnable.Select(c => new object[] { c.Id });

    public static ContractCase ById(string id) => All.Single(c => c.Id == id);

    private static List<ContractCase> Load()
    {
        var cases = new List<ContractCase>();
        foreach (var file in Directory.GetFiles(FixtureDir, "*.cases.json").Order(StringComparer.Ordinal))
        {
            var group = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
            var groupName = group["group"]!.GetValue<string>();
            var groupRepo = group["repo"]?.AsObject() ?? new JsonObject { ["base"] = "sample_repo" };
            foreach (var node in group["cases"]!.AsArray())
            foreach (var expanded in Expand(node!.AsObject()))
            {
                var repo = (JsonObject)groupRepo.DeepClone();
                foreach (var kv in expanded["repo"]?.AsObject() ?? []) repo[kv.Key] = kv.Value?.DeepClone();
                cases.Add(new ContractCase(
                    $"{groupName}::{expanded["id"]!.GetValue<string>()}",
                    groupName,
                    repo,
                    expanded["requires"]?.AsArray().Select(r => r!.GetValue<string>()).ToArray() ?? [],
                    expanded["steps"]!.AsArray()));
            }
        }
        return cases;
    }

    private static IEnumerable<JsonObject> Expand(JsonObject template)
    {
        if (template["matrix"] is not JsonObject matrix)
        {
            yield return template;
            yield break;
        }
        var (name, values) = matrix.First();
        foreach (var value in values!.AsArray())
        {
            var text = value!.ToString();
            var clone = (JsonObject)template.DeepClone();
            clone.Remove("matrix");
            var substituted = JsonNode.Parse(clone.ToJsonString().Replace("${" + name + "}", Escape(text)))!.AsObject();
            substituted["id"] = $"{template["id"]!.GetValue<string>()}[{text}]";
            yield return substituted;
        }
    }

    private static string Escape(string text) => System.Text.Json.JsonSerializer.Serialize(text)[1..^1];
}
