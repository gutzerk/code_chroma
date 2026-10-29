using System.Collections.Concurrent;
using System.Text.RegularExpressions;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>One-time move of the pre-rename <c>.codechroma/diagrams/c1/c1.json</c> (and its canvas projection) to <c>system-context</c>.</summary>
public static partial class LegacyDiagramMigration
{
    private static readonly ConcurrentDictionary<string, bool> Done = new();

    [GeneratedRegex(@"""layer""\s*:\s*""c1""")]
    private static partial Regex LayerField();

    /// <summary>Moves the legacy folder for this root once per process; never throws, a failed move just leaves the old folder in place.</summary>
    public static void Run(string root)
    {
        if (!Done.TryAdd(root, true)) return;
        var diagrams = Path.Combine(root, ".codechroma", "diagrams");
        var legacy = Path.Combine(diagrams, "c1");
        var current = Path.Combine(diagrams, "system-context");
        try
        {
            if (!Directory.Exists(legacy) || Directory.Exists(current)) return;
            Directory.Move(legacy, current);
            var oldFile = Path.Combine(current, "c1.json");
            if (File.Exists(oldFile)) File.Move(oldFile, Path.Combine(current, "system-context.json"));
            var projection = Path.Combine(current, "projection.json");
            if (File.Exists(projection)) File.WriteAllText(projection, LayerField().Replace(File.ReadAllText(projection), "\"layer\": \"system-context\""));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"system-context: legacy c1 folder migration failed: {error.Message}");
        }
    }
}
