using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>Context windows from the model catalog Claude Code caches in `&lt;config&gt;/cache/model-catalog/*.json` (`runtime.max_input_tokens`); the newest fetch wins.</summary>
public static class ClaudeModelCatalog
{
    private static readonly object Gate = new();
    private static (string Key, CachedCatalog Catalog)? _cached;

    /// <summary>The newest catalog's context windows and the newest catalog's model list, parsed once per set of file stamps.</summary>
    private sealed record CachedCatalog(IReadOnlyDictionary<string, long> Windows, JsonArray Models);

    private static readonly CachedCatalog Empty = new(new Dictionary<string, long>(), []);

    public static string DefaultDir() => Path.Combine(Transcripts.ConfigDir(), "cache", "model-catalog");

    /// <summary>A model id without its dated snapshot suffix ("-20260101" or "@20260101").</summary>
    public static string BaseId(string model)
    {
        var id = model.Trim();
        return id.Length > 9 && id[^9] is '-' or '@' && id[^8..].All(char.IsDigit) ? id[..^9] : id;
    }

    /// <summary>The catalog's input-token limit for a base model id, or null when no cached catalog lists it.</summary>
    public static long? MaxInputTokens(string baseId, string catalogDir) =>
        Load(catalogDir).Windows.TryGetValue(baseId, out var window) ? window : null;

    /// <summary>The newest cached catalog's models as {id, label} (label: its display name, else null); empty when no cache lists any. Each caller gets its own copy.</summary>
    public static JsonArray Models(string catalogDir) => (JsonArray)Load(catalogDir).Models.DeepClone();

    private static CachedCatalog Load(string dir)
    {
        List<(string Path, DateTime Stamp)> files;
        try { files = Directory.Exists(dir) ? Directory.EnumerateFiles(dir, "*.json").Select(p => (p, File.GetLastWriteTimeUtc(p))).ToList() : []; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return Empty; }
        var key = dir + "|" + string.Join("|", files.Select(f => f.Path + "@" + f.Stamp.Ticks));
        lock (Gate)
        {
            if (_cached is { } hit && hit.Key == key) return hit.Catalog;
            var parsed = files.Select(f => Read(f.Path)).OfType<Parsed>().ToList();
            var catalog = new CachedCatalog(
                parsed.Where(c => c.Windows.Count > 0).MaxBy(c => c.FetchedAt)?.Windows ?? new Dictionary<string, long>(),
                parsed.Where(c => c.Models.Count > 0).MaxBy(c => c.FetchedAt)?.Models ?? []);
            _cached = (key, catalog);
            return catalog;
        }
    }

    private sealed record Parsed(long FetchedAt, Dictionary<string, long> Windows, JsonArray Models);

    private static Parsed? Read(string path)
    {
        if (JsonFile.Load(path) is not JsonObject root || root["catalog"]?["config"]?["models"] is not JsonArray models) return null;
        var windows = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        var listed = new JsonArray();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var model in models.OfType<JsonObject>())
        {
            if (Json.Str(model["id"]) is not { Length: > 0 } id) continue;
            if (model["runtime"]?["max_input_tokens"] is JsonValue v && v.TryGetValue<long>(out var window) && window > 0) windows[BaseId(id)] = window;
            if (seen.Add(id)) listed.Add(new JsonObject { ["id"] = id, ["label"] = Json.Str(model["display_name"]) ?? Json.Str(model["displayName"]) ?? Json.Str(model["name"]) });
        }
        var fetchedAt = root["fetchedAt"] is JsonValue f && f.TryGetValue<long>(out var at) ? at : 0;
        return new Parsed(fetchedAt, windows, listed);
    }
}
