using System.Text.Json.Nodes;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core.Wiki;

namespace CodeChroma.Bridge.Wiki;

/// <summary>A running char total against a cap; shared by the wiki-context bundle builders (io.CharBudget).</summary>
public sealed class CharBudget(int maxChars, int used = 0)
{
    public bool Truncated { get; private set; }

    public bool TryAdd(string content)
    {
        if (used + content.Length > maxChars)
        {
            Truncated = true;
            return false;
        }
        used += content.Length;
        return true;
    }
}

/// <summary>One wiki page's content for a requested path, a file or a folder.</summary>
public sealed record WikiContextPage(string Path, string Kind, string Content);

/// <summary>What GET /repos/{id}/wiki-context returns.</summary>
public sealed record WikiContextBundle(bool HasWiki, string? Root, IReadOnlyList<WikiContextPage> Pages, IReadOnlyList<string> Gaps, bool Truncated)
{
    public static WikiContextBundle Missing { get; } = new(false, null, [], [], false);

    public JsonObject ToJson() => new()
    {
        ["has_wiki"] = HasWiki,
        ["root"] = Root,
        ["pages"] = new JsonArray(Pages.Select(p => (JsonNode?)new JsonObject { ["path"] = p.Path, ["kind"] = p.Kind, ["content"] = p.Content }).ToArray()),
        ["gaps"] = new JsonArray(Gaps.Select(g => (JsonNode?)JsonValue.Create(g)).ToArray()),
        ["truncated"] = Truncated,
    };
}

/// <summary>The wiki-page bundle a diagram-drawing skill reads instead of a full raw-context dump (bridge/wiki_context.py).</summary>
public static class WikiContext
{
    public const int MaxChars = 20000;

    public static string WikiDir(string repoRoot) => Path.Combine(repoRoot, ".codechroma", "wiki");

    private static string FolderPagePath(string wikiDir, string folderPath) => Path.Combine(wikiDir, "files", folderPath, "index.md");

    private static string FilePagePath(string wikiDir, string filePath) => Path.Combine(wikiDir, "files", WikiGenerator.FilePageRelativePath(filePath));

    /// <summary>The file page's text, or null when no page exists.</summary>
    public static string? SafeFileText(string wikiDir, string filePath)
    {
        try
        {
            return SourceText.ReadWithin(wikiDir, FilePagePath(wikiDir, filePath));
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static string? SafeFolderText(string wikiDir, string folderPath)
    {
        try
        {
            return SourceText.ReadWithin(wikiDir, FolderPagePath(wikiDir, folderPath));
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /// <summary>Root-to-leaf proper-prefix folder paths for a path, excluding the path itself.</summary>
    private static IEnumerable<string> ProperAncestors(string path)
    {
        var parts = path.Split('/');
        for (var i = 1; i < parts.Length; i++) yield return string.Join('/', parts.Take(i));
    }

    private static List<(string Path, string Kind, string Content)>? EntriesFor(string wikiDir, string requested, HashSet<string> seen)
    {
        var entries = new List<(string, string, string)>();
        foreach (var folder in ProperAncestors(requested))
            if (!seen.Contains(folder) && SafeFolderText(wikiDir, folder) is { } text) entries.Add((folder, "folder", text));
        if (SafeFolderText(wikiDir, requested) is { } folderText)
        {
            entries.Add((requested, "folder", folderText));
            return entries;
        }
        if (SafeFileText(wikiDir, requested) is { } fileText)
        {
            entries.Add((requested, "file", fileText));
            return entries;
        }
        return null;
    }

    /// <summary>The root page plus each requested path's ancestor-folder and own page.</summary>
    public static WikiContextBundle Build(string wikiDir, IReadOnlyList<string> paths)
    {
        var rootText = SourceText.Read(Path.Combine(wikiDir, "index.md"));
        if (rootText is null) return WikiContextBundle.Missing;

        var budget = new CharBudget(MaxChars, rootText.Length);
        var pages = new List<WikiContextPage>();
        var gaps = new List<string>();
        var seen = new HashSet<string>();
        foreach (var requested in paths)
        {
            if (budget.Truncated) break;
            if (seen.Contains(requested)) continue;
            var entries = EntriesFor(wikiDir, requested, seen);
            if (entries is null)
            {
                gaps.Add(requested);
                seen.Add(requested);
                continue;
            }
            foreach (var (path, kind, content) in entries)
            {
                if (seen.Contains(path)) continue;
                if (!budget.TryAdd(content)) break;
                pages.Add(new WikiContextPage(path, kind, content));
                seen.Add(path);
            }
        }
        return new WikiContextBundle(true, rootText, pages, gaps, budget.Truncated);
    }

    /// <summary>The bundle for a workspace, freshly synced; a missing wiki reports has_wiki false.</summary>
    public static WikiContextBundle ForWorkspace(Workspace ws, IReadOnlyList<string> paths)
    {
        var wikiDir = WikiDir(ws.Root);
        if (!File.Exists(Path.Combine(wikiDir, "index.md"))) return WikiContextBundle.Missing;
        Sync(ws);
        return Build(wikiDir, paths);
    }

    /// <summary>Regenerates only what changed since the last sync; a no-op for an engine without a graph.</summary>
    public static void Sync(Workspace ws)
    {
        if (ws.Engine.GraphSnapshot() is { } graph) WikiSync.Sync(graph, ws.Root, WikiDir(ws.Root));
    }
}

/// <summary>Generates `.codechroma/wiki/` once, the first time a writable workspace comes up; offline, never reaches Claude.</summary>
public static class WikiBootstrap
{
    public static void IfMissing(Workspace ws)
    {
        if (ws.ReadOnly || File.Exists(Path.Combine(WikiContext.WikiDir(ws.Root), "index.md"))) return;
        try
        {
            if (ws.Engine.GraphSnapshot() is not { } graph) return;
            WikiGenerator.Generate(graph, ws.Root, WikiContext.WikiDir(ws.Root));
        }
        catch (Exception error)
        {
            // A failed bootstrap must never fail the analyze that triggered it.
            Console.Error.WriteLine($"wiki: bootstrap generation failed: {error.Message}");
        }
    }
}
