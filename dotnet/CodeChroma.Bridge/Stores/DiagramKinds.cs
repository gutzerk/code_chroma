using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Stores;

/// <summary>The built-in diagram kinds and schematic ids, embedded from src/codechroma/diagrams/kinds.json (the Python bridge reads the same file).</summary>
public static class DiagramKinds
{
    private static readonly Lazy<JsonObject> Data = new(() =>
    {
        using var stream = typeof(DiagramKinds).Assembly.GetManifestResourceStream("diagram_kinds.json")
            ?? throw new InvalidOperationException("diagram_kinds.json is not embedded");
        return (JsonObject)JsonNode.Parse(stream)!;
    });

    public static JsonNode List => Data.Value["kinds"]!;

    public static IReadOnlyList<string> Schematics { get; } = Strings("schematics");

    public static IReadOnlySet<string> Ids { get; } = Data.Value["kinds"]!.AsArray().Select(k => k!["id"]!.GetValue<string>()).ToHashSet();

    public static int MaxRequestChars { get; } = Data.Value["max_request_chars"]!.GetValue<int>();

    private static List<string> Strings(string key) => Data.Value[key]!.AsArray().Select(s => s!.GetValue<string>()).ToList();
}
