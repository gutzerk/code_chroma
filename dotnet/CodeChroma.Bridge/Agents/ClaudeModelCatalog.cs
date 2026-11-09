using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>Context windows from the model catalog Claude Code caches in `&lt;config&gt;/cache/model-catalog/*.json` (`runtime.max_input_tokens`); the newest fetch wins.</summary>
public static class ClaudeModelCatalog
{
    private static readonly object Gate = new();
    private static (string Key, IReadOnlyDictionary<string, long> Windows)? _cached;

    public static string DefaultDir() => Path.Combine(Transcripts.ConfigDir(), "cache", "model-catalog");

    /// <summary>A model id without its dated snapshot suffix ("-20260101" or "@20260101").</summary>
    public static string BaseId(string model)
    {
        var id = model.Trim();
        return id.Length > 9 && id[^9] is '-' or '@' && id[^8..].All(char.IsDigit) ? id[..^9] : id;
    }

    /// <summary>The catalog's input-token limit for a base model id, or null when no cached catalog lists it.</summary>
    public static long? MaxInputTokens(string baseId, string catalogDir) =>
        Windows(catalogDir).TryGetValue(baseId, out var window) ? window : null;

    private static IReadOnlyDictionary<string, long> Windows(string dir)
    {
        List<(string Path, DateTime Stamp)> files;
        try { files = Directory.Exists(dir) ? Directory.EnumerateFiles(dir, "*.json").Select(p => (p, File.GetLastWriteTimeUtc(p))).ToList() : []; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return new Dictionary<string, long>(); }
        var key = dir + "|" + string.Join("|", files.Select(f => f.Path + "@" + f.Stamp.Ticks));
        lock (Gate)
        {
            if (_cached is { } hit && hit.Key == key) return hit.Windows;
            var newest = files.Select(f => Read(f.Path)).Where(c => c is not null).OrderByDescending(c => c!.Value.FetchedAt).FirstOrDefault();
            IReadOnlyDictionary<string, long> windows = newest?.Windows ?? new Dictionary<string, long>();
            _cached = (key, windows);
            return windows;
        }
    }

    private static (long FetchedAt, Dictionary<string, long> Windows)? Read(string path)
    {
        if (JsonFile.Load(path) is not JsonObject root || root["catalog"]?["config"]?["models"] is not JsonArray models) return null;
        var windows = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        foreach (var model in models.OfType<JsonObject>())
            if (Json.Str(model["id"]) is { Length: > 0 } id && model["runtime"]?["max_input_tokens"] is JsonValue v && v.TryGetValue<long>(out var window) && window > 0)
                windows[BaseId(id)] = window;
        var fetchedAt = root["fetchedAt"] is JsonValue f && f.TryGetValue<long>(out var at) ? at : 0;
        return windows.Count > 0 ? (fetchedAt, windows) : null;
    }
}
