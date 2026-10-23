using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Stores;

/// <summary>Where the machine-local settings files live; the same env vars as the Python stores win over the home default.</summary>
public sealed class UserPaths
{
    public required string Assistant { get; init; }
    public required string Runtime { get; init; }
    public required string Providers { get; init; }
    public required string CallSites { get; init; }
    public required string DiagramTypes { get; init; }
    public required string Workflows { get; init; }
    public required string CanvasStyle { get; init; }

    public static UserPaths FromEnvironment() => new()
    {
        Assistant = Resolve("codechroma_ASSISTANT_SETTINGS_FILE", "assistant-settings.json"),
        Runtime = Resolve("codechroma_RUNTIME_SETTINGS_FILE", "runtime-environment.json"),
        Providers = Resolve("codechroma_LLM_PROVIDERS_FILE", "llm-providers.json"),
        CallSites = Resolve("codechroma_LLM_CALL_SITE_SETTINGS_FILE", "llm-call-site-settings.json"),
        DiagramTypes = Resolve("codechroma_DIAGRAM_TYPES_DIR", "diagram-types"),
        Workflows = Resolve("codechroma_WORKFLOWS_DIR", "workflows"),
        CanvasStyle = Resolve("codechroma_CANVAS_STYLE_FILE", "canvas-style.json"),
    };

    /// <summary>Every store under one directory (tests).</summary>
    public static UserPaths Under(string directory) => new()
    {
        Assistant = Path.Combine(directory, "assistant-settings.json"),
        Runtime = Path.Combine(directory, "runtime-environment.json"),
        Providers = Path.Combine(directory, "llm-providers.json"),
        CallSites = Path.Combine(directory, "llm-call-site-settings.json"),
        DiagramTypes = Path.Combine(directory, "diagram-types"),
        Workflows = Path.Combine(directory, "workflows"),
        CanvasStyle = Path.Combine(directory, "canvas-style.json"),
    };

    internal static string Resolve(string envVar, string fileName)
    {
        var configured = Environment.GetEnvironmentVariable(envVar);
        if (!string.IsNullOrEmpty(configured)) return Path.GetFullPath(ExpandUser(configured));
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codechroma", fileName);
    }

    private static string ExpandUser(string path) =>
        path.StartsWith('~') ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + path[1..] : path;
}

/// <summary>Atomic JSON file reads and writes for the settings stores, serialized process-wide.</summary>
public static class JsonFile
{
    private static readonly object Gate = new();

    /// <summary>The parsed file, or null when it is missing or not valid JSON.</summary>
    public static JsonNode? Load(string path)
    {
        try
        {
            lock (Gate) return JsonNode.Parse(File.ReadAllText(path));
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public static JsonObject LoadObject(string path) => Load(path) as JsonObject ?? new JsonObject();

    public static void Write(string path, JsonNode payload) =>
        WriteText(path, payload.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));

    /// <summary>Atomically replaces the file with already-serialized text (temp file + move, retried on Windows locks).</summary>
    public static void WriteText(string path, string text)
    {
        lock (Gate)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temp = $"{path}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
            try
            {
                File.WriteAllText(temp, text);
                for (var attempt = 0; ; attempt++)
                {
                    try { File.Move(temp, path, overwrite: true); break; }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException && attempt < 4) { Thread.Sleep(25 * (attempt + 1)); }
                }
            }
            finally
            {
                try { File.Delete(temp); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            }
        }
    }

    /// <summary>Runs a read-modify-write section so concurrent saves cannot interleave.</summary>
    public static T Locked<T>(Func<T> section)
    {
        lock (Gate) return section();
    }
}

/// <summary>Python-shaped reads over loosely typed JSON bodies (truthiness, isinstance checks).</summary>
public static class Json
{
    public static string? Str(JsonNode? node) => node is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    /// <summary>The string value, or null when it is absent, not a string or empty.</summary>
    public static string? NonEmptyStr(JsonNode? node) => Str(node) is { Length: > 0 } s ? s : null;

    /// <summary>True only for a JSON true.</summary>
    public static bool Bool(JsonNode? node) => node is JsonValue v && v.TryGetValue(out bool b) && b;

    public static bool IsString(JsonNode? node) => Str(node) is not null;

    public static bool IsBlank(string? text) => string.IsNullOrWhiteSpace(text);

    /// <summary>Python's bool(value) for a JSON value.</summary>
    public static bool Truthy(JsonNode? node) => node switch
    {
        null => false,
        JsonArray a => a.Count > 0,
        JsonObject o => o.Count > 0,
        JsonValue v when v.TryGetValue(out string? s) => s.Length > 0,
        JsonValue v when v.TryGetValue(out bool b) => b,
        JsonValue v => v.GetValueKind() == JsonValueKind.Number && v.GetValue<double>() != 0,
        _ => true,
    };

    public static JsonNode? Clone(JsonNode? node) => node?.DeepClone();
}
