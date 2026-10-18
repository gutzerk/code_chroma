using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Wiki;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Skills;

/// <summary>The AI-generated semantic architecture map (.codechroma/wiki-general): bookkeeping, staleness and the context bundle.</summary>
public static class WikiGeneral
{
    public const string Kind = "wiki-general";
    public const string KindUpdate = "wiki-general-update";
    public const string NoDocumentableContentError = "repository has no code yet -- nothing to document";
    public const int ContextMaxChars = 20000;

    private static readonly HashSet<string> NonCodeExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".md", ".markdown", ".mdx", ".rst", ".txt", ".adoc", ".json", ".yml", ".yaml",
    };

    private static readonly HashSet<string> IgnoredDirs = new(StringComparer.Ordinal)
    {
        "node_modules", "__pycache__", "venv", ".venv", "dist", "build", "vendor", "target", "bin", "obj",
    };

    private static readonly ConcurrentDictionary<string, SemaphoreSlim> RunLocks = new();

    /// <summary>The lock generate and update both hold across their refuse-check-then-start sequence.</summary>
    public static SemaphoreSlim RunLock(string workspaceId) => RunLocks.GetOrAdd(workspaceId, _ => new SemaphoreSlim(1, 1));

    public static string Dir(string root) => Path.Combine(root, ".codechroma", "wiki-general");

    public static string ManifestPath(string root, string _ = "") => Path.Combine(Dir(root), "manifest.json");

    /// <summary>A light shape gate: non-empty containers and components lists whose entries carry string ids.</summary>
    public static bool ValidManifest(JsonNode? data) =>
        data is JsonObject o && o["containers"] is JsonArray { Count: > 0 } containers && o["components"] is JsonArray { Count: > 0 } components
        && containers.All(c => c is JsonObject co && Json.IsString(co["id"])) && components.All(c => c is JsonObject co && Json.IsString(co["id"]));

    public static IEnumerable<SkillAgents.KindSpec> Specs()
    {
        yield return new SkillAgents.KindSpec(Kind, new SkillAgentSpec(
            "wiki_general_agent", null, SkillTimeouts.Model, (root, id) => ManifestPath(root, id), ValidManifest,
            "codechroma_WIKI_GENERAL_TIMEOUT_SECONDS", SkillTimeouts.For(Kind), "generation produced no valid wiki-general manifest", WikiGeneralPipeline.Run));
        yield return new SkillAgents.KindSpec(KindUpdate, new SkillAgentSpec(
            "wiki_general_update_agent", Prompts.Render("wiki_general_update_agent"), SkillTimeouts.Model, (root, id) => ManifestPath(root, id), ValidManifest,
            "codechroma_WIKI_GENERAL_UPDATE_TIMEOUT_SECONDS", SkillTimeouts.For(KindUpdate), "update produced no valid wiki-general manifest"));
    }

    /// <summary>Full replace before a new run: c2 and c3 come back empty so no subagent has to mkdir.</summary>
    public static void Clear(string root)
    {
        var directory = Dir(root);
        try { Directory.Delete(directory, recursive: true); } catch (DirectoryNotFoundException) { }
        Directory.CreateDirectory(Path.Combine(directory, "c2"));
        Directory.CreateDirectory(Path.Combine(directory, "c3"));
    }

    /// <summary>Clears stale pages and readies the plain wiki before a run; an error message on failure, else null.</summary>
    public static string? PrepareNewRun(Workspace ws)
    {
        Clear(ws.Root);
        try
        {
            WikiBootstrap.IfMissing(ws);
            WikiContext.Sync(ws);
        }
        catch (Exception error)
        {
            return $"plain wiki sync failed: {error.Message}";
        }
        return null;
    }

    /// <summary>False when the repo has nothing but a placeholder, doc or config tree: no run should start.</summary>
    public static bool HasDocumentableContent(string root)
    {
        var pending = new Stack<string>([root]);
        while (pending.Count > 0)
        {
            var directory = pending.Pop();
            foreach (var file in Directory.EnumerateFiles(directory))
            {
                var name = Path.GetFileName(file);
                if (!name.StartsWith('.') && !NonCodeExtensions.Contains(Path.GetExtension(file))) return true;
            }
            foreach (var sub in Directory.EnumerateDirectories(directory))
            {
                var name = Path.GetFileName(sub);
                if (!name.StartsWith('.') && !IgnoredDirs.Contains(name)) pending.Push(sub);
            }
        }
        return false;
    }

    /// <summary>Records the HEAD this tree now reflects, right after a successful run.</summary>
    public static void StampGeneratedCommit(Workspace ws)
    {
        if (ws.CurrentHead() is not { } head) return;
        if (JsonFile.Load(ManifestPath(ws.Root)) is not JsonObject manifest) return;
        manifest["generated_at_commit"] = head;
        JsonFile.Write(ManifestPath(ws.Root), manifest);
    }

    public static bool IsStale(Workspace ws, JsonObject manifest) => ws.CurrentHead() is { } head && Json.Str(manifest["generated_at_commit"]) != head;

    /// <summary>The root overview plus every container page under a character budget; has_wiki_general false without a valid tree.</summary>
    public static JsonObject Context(string root)
    {
        var directory = Dir(root);
        var manifest = JsonFile.Load(ManifestPath(root));
        var rootText = ReadWithin(directory, Path.Combine(directory, "index.md"));
        if (!ValidManifest(manifest) || rootText is null)
            return new JsonObject { ["has_wiki_general"] = false, ["generated_at"] = null, ["root"] = null, ["containers"] = new JsonArray(), ["truncated"] = false };
        var used = rootText.Length;
        var truncated = false;
        var containers = new JsonArray();
        foreach (var entry in manifest!["containers"]!.AsArray().OfType<JsonObject>())
        {
            if (Json.Str(entry["id"]) is not { } id || Json.Str(entry["path"]) is not { } path) continue;
            if (ReadWithin(directory, Path.Combine(directory, path)) is not { } content) continue;
            if (used + content.Length > ContextMaxChars) { truncated = true; break; }
            used += content.Length;
            containers.Add(new JsonObject { ["id"] = id, ["name"] = Json.Str(entry["name"]) ?? id, ["content"] = content });
        }
        return new JsonObject
        {
            ["has_wiki_general"] = true, ["generated_at"] = Json.Str(manifest["generated_at"]), ["root"] = rootText,
            ["containers"] = containers, ["truncated"] = truncated,
        };
    }

    private static string? ReadWithin(string baseDirectory, string path)
    {
        var full = Path.GetFullPath(path);
        var root = Path.GetFullPath(baseDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(root, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal)) return null;
        try
        {
            return Epics.PyText.ReadText(full);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Text.DecoderFallbackException)
        {
            return null;
        }
    }
}
