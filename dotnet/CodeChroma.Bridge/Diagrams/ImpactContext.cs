using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core.Analyzers;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>The signal the impact skill reads: a rich slice around a change's seeds, plus the staleness fingerprint (bridge/impact_context.py).</summary>
public static partial class ImpactContext
{
    private static readonly string[] SpecSeedFiles = ["plan.md", "tasks.md"];

    // Python slices the leading dot off each extension and endswith()s the rest; kept as is so the two backends agree.
    private static readonly string[] SourceSuffixes = AnalyzerRegistry.WithDefaults().SupportedExtensions().Select(e => e[1..]).ToArray();

    [GeneratedRegex("`([^`]+)`")]
    private static partial Regex Backticked();

    private static string RoleFor(HierarchyLevel level) => level switch
    {
        HierarchyLevel.System or HierarchyLevel.Pillar => "dir",
        HierarchyLevel.Component => "file",
        HierarchyLevel.Service => "class",
        HierarchyLevel.Function => "function",
        _ => "code",
    };

    public static string NormalizeSource(string? source, string fallback = "diff") => source is "diff" or "plan" ? source : fallback;

    public static string AuthoredSource(JsonObject authored, string fallback = "diff") => NormalizeSource(Json.Str(authored["source"]) ?? fallback, fallback);

    public static string? AuthoredFeature(JsonObject authored) => Json.Str(authored["feature"]) is { Length: > 0 } feature ? feature : null;

    private static string? FeatureDir(Workspace ws, string? feature)
    {
        if (string.IsNullOrEmpty(feature)) return null;
        try
        {
            var path = Path.GetFullPath(Path.IsPathRooted(feature) ? feature : Path.Combine(ws.Root, feature));
            return Directory.Exists(path) ? path : null;
        }
        catch (Exception error) when (error is IOException or ArgumentException or NotSupportedException)
        {
            return null;
        }
    }

    /// <summary>Seed node id to the spec line naming it, mined from a feature dir's plan.md and tasks.md.</summary>
    public static Dictionary<string, string> FeatureSpecSeeds(Workspace ws, string? feature)
    {
        var seeds = new Dictionary<string, string>();
        if (FeatureDir(ws, feature) is not { } dir) return seeds;
        foreach (var file in SpecSeedFiles)
        {
            var path = Path.Combine(dir, file);
            if (!File.Exists(path)) continue;
            foreach (var (token, line) in CodePaths(File.ReadAllText(path)))
                seeds.TryAdd(PlanResolver.ResolveTarget(ws.Engine, token, null).NodeId, line);
        }
        return seeds;
    }

    private static IEnumerable<(string Token, string Line)> CodePaths(string text)
    {
        foreach (var line in text.ReplaceLineEndings("\n").Split('\n'))
            foreach (Match match in Backticked().Matches(line))
            {
                var token = match.Groups[1].Value.Trim();
                if (!token.Contains('/') || !SourceSuffixes.Any(s => token.EndsWith(s, StringComparison.Ordinal))) continue;
                if (token.StartsWith("http://", StringComparison.Ordinal) || token.StartsWith("https://", StringComparison.Ordinal)
                    || token.StartsWith("docs/", StringComparison.Ordinal) || token.StartsWith("specs/", StringComparison.Ordinal)) continue;
                yield return (token, line.Trim());
            }
    }

    private static Dictionary<string, string> SourceSeeds(Workspace ws, IOldSymbolParser parser, string source, string? feature)
    {
        if (source == "plan") return FeatureSpecSeeds(ws, feature);
        var seeds = new Dictionary<string, string>();
        foreach (var card in ChangeCards.Build(ws.Engine, ws.Root, parser, ws.DiffBase())["cards"]!.AsArray().OfType<JsonObject>())
            seeds[Json.Str(card["node_id"])!] = Json.Str(card["status"]) is { Length: > 0 } status ? status : "changed";
        return seeds;
    }

    private static JsonArray AnchorPath(IGraphEngine engine, string nodeId)
    {
        var anchors = new JsonArray();
        var parentId = nodeId;
        for (var i = 0; i < 4; i++)
        {
            if (engine.GetNode(parentId) is not { ParentIds.Count: > 0 } node) break;
            parentId = node.ParentIds[0];
            if (engine.GetNode(parentId) is { } parent && parent.Id != IGraphEngine.RootSentinel) anchors.Add(parent.Name);
        }
        return anchors;
    }

    /// <summary>The rich slice payload GET /repos/{id}/impact/context returns to the impact skill.</summary>
    public static JsonObject Build(Workspace ws, IOldSymbolParser parser, string source = "diff", string? feature = null)
    {
        ws.Sync();
        var seeds = SourceSeeds(ws, parser, source, feature);
        var slice = ImpactSlice.Resolve(ws.Engine, seeds.Keys.Order(StringComparer.Ordinal).ToList());
        var nodes = new JsonArray();
        foreach (var node in slice["nodes"]!.AsArray().OfType<JsonObject>())
        {
            var nodeId = Json.Str(node["node_id"])!;
            var graphNode = ws.Engine.GetNode(nodeId);
            var isSeed = node["seed"]!.GetValue<bool>();
            nodes.Add(new JsonObject
            {
                ["id"] = nodeId,
                ["name"] = node["name"]!.DeepClone(),
                ["node_id"] = nodeId,
                ["seed"] = isSeed,
                ["path"] = graphNode?.SourcePath,
                ["level"] = graphNode is null ? "" : RoleFor(graphNode.Level),
                ["kinds"] = new JsonArray((graphNode?.SymbolIds ?? []).Select(id => (JsonNode?)JsonValue.Create(id)).ToArray()),
                ["reason"] = isSeed && seeds.TryGetValue(nodeId, out var reason) ? reason : null,
                ["anchors"] = AnchorPath(ws.Engine, nodeId),
            });
        }
        return new JsonObject
        {
            ["source"] = source,
            ["feature"] = source == "plan" ? feature : null,
            ["nodes"] = nodes,
            ["relations"] = slice["relations"]!.DeepClone(),
            ["seed_count"] = slice["seed_count"]!.DeepClone(),
            ["node_count"] = slice["node_count"]!.DeepClone(),
            ["truncated"] = slice["truncated"]!.DeepClone(),
            ["fingerprint"] = Fingerprint(ws, source, feature, seeds),
        };
    }

    /// <summary>The slice's "what changed" identity for staleness, computed without rebuilding the slice.</summary>
    public static string Fingerprint(Workspace ws, string source = "diff", string? feature = null, Dictionary<string, string>? seeds = null)
    {
        if (source != "plan") return DiffFingerprint(ws, ws.DiffBase());
        seeds ??= FeatureSpecSeeds(ws, feature);
        return PatternSerialize.HashLines(seeds.Select(kv => $"{kv.Key} {kv.Value}"));
    }

    public static int SeedCount(Workspace ws, string source = "diff", string? feature = null, Dictionary<string, string>? seeds = null) =>
        source == "plan" ? (seeds ?? FeatureSpecSeeds(ws, feature)).Count : 0;

    private static string DiffFingerprint(Workspace ws, string baseRef)
    {
        if (GitTree.Detect(ws.Root) is not { } tree) return "";
        return PatternSerialize.HashLines(tree.Status(baseRef).Statuses
            .Where(kv => !kv.Key.Split('/').Contains(".codechroma"))
            .Select(kv => $"{kv.Value} {kv.Key}"));
    }
}
