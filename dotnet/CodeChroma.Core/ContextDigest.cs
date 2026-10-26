using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Tomlyn;
using Tomlyn.Model;

namespace CodeChroma.Core;

/// <summary>Port of context/digest.py: the compact external-integration digest a C1 author reads.</summary>
public static partial class ContextDigest
{
    public const int ReadmeExcerptChars = 1500;

    private static readonly HashSet<string> StdlibDenylist =
    [
        "os", "sys", "re", "io", "json", "typing", "pathlib", "collections", "dataclasses",
        "functools", "itertools", "logging", "subprocess", "shutil", "threading", "asyncio",
        "contextlib", "hashlib", "uuid", "datetime", "argparse", "socket", "signal", "time",
        "abc", "enum", "copy", "math", "random", "string", "textwrap", "traceback", "warnings",
        "unittest", "importlib", "inspect", "tempfile", "glob", "csv",
    ];

    private static readonly string[] ReadmeNames = ["README.md", "readme.md", "README.rst", "README.txt"];

    [GeneratedRegex(@"/v\d+$")]
    private static partial Regex GoVersionSuffix();

    [GeneratedRegex(@"^require\s*\($")]
    private static partial Regex GoRequireBlockStart();

    [GeneratedRegex(@"^require\s+(\S+)")]
    private static partial Regex GoRequireSingleLine();

    public static JsonObject Build(Graph graph, string repoRoot, int readmeChars = ReadmeExcerptChars)
    {
        var known = graph.NodeList
            .Where(n => n.Level is HierarchyLevel.System or HierarchyLevel.Pillar)
            .Select(n => n.Name).ToHashSet(StringComparer.Ordinal);
        return new JsonObject
        {
            ["repo_name"] = Path.GetFileName(Path.GetFullPath(repoRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)),
            ["external_import_roots"] = ExternalImportRoots(graph, known),
            ["declared_dependencies"] = new JsonArray(DeclaredDependencies(repoRoot).Select(d => (JsonNode?)JsonValue.Create(d)).ToArray()),
            ["readme_excerpt"] = ReadmeExcerpt(repoRoot, readmeChars),
        };
    }

    private static JsonArray ExternalImportRoots(Graph graph, HashSet<string> known)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var symbol in graph.SymbolList)
            foreach (var dotted in symbol.Imports.Values)
            {
                var root = dotted.Split('.', 2)[0];
                if (root.Length == 0 || known.Contains(root) || StdlibDenylist.Contains(root)) continue;
                if (counts.TryAdd(root, 1)) order.Add(root);
                else counts[root]++;
            }
        var result = new JsonArray();
        foreach (var root in order.OrderByDescending(r => counts[r]))
            result.Add(new JsonObject { ["root"] = root, ["count"] = counts[root] });
        return result;
    }

    private static List<string> DeclaredDependencies(string repoRoot)
    {
        var names = new List<string>();
        if (ReadText(Path.Combine(repoRoot, "pyproject.toml")) is { } toml)
        {
            try
            {
                var data = TomlSerializer.Deserialize<TomlTable>(toml);
                if (data is not null && data.TryGetValue("project", out var project) && project is TomlTable table
                    && table.TryGetValue("dependencies", out var deps) && deps is TomlArray array)
                    names.AddRange(array.OfType<string>().Select(DependencyName));
            }
            catch (Exception e) when (e is TomlException or InvalidOperationException) { }
        }

        if (ReadText(Path.Combine(repoRoot, "package.json")) is { } json)
        {
            try
            {
                if (JsonNode.Parse(json) is JsonObject root && root["dependencies"] is JsonObject deps)
                    names.AddRange(deps.Select(kv => kv.Key));
            }
            catch (System.Text.Json.JsonException) { }
        }

        names.AddRange(GoModDependencies(repoRoot));
        return names;
    }

    private static List<string> GoModDependencies(string repoRoot)
    {
        var names = new List<string>();
        if (ReadText(Path.Combine(repoRoot, "go.mod")) is not { } text) return names;
        var inBlock = false;
        foreach (var line in text.Split('\n'))
        {
            var stripped = line.Split("//", 2)[0].Trim();
            if (stripped.Length == 0) continue;
            if (inBlock)
            {
                if (stripped == ")") inBlock = false;
                else names.Add(GoVersionSuffix().Replace(stripped.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)[0], ""));
            }
            else if (GoRequireBlockStart().IsMatch(stripped)) inBlock = true;
            else if (GoRequireSingleLine().Match(stripped) is { Success: true } m) names.Add(GoVersionSuffix().Replace(m.Groups[1].Value, ""));
        }
        return names;
    }

    private static string DependencyName(string requirement)
    {
        var cut = requirement.IndexOfAny([' ', '(', '>', '<', '=', '!', '~', '[', ';']);
        return (cut < 0 ? requirement : requirement[..cut]).Trim();
    }

    private static string? ReadmeExcerpt(string repoRoot, int chars)
    {
        foreach (var name in ReadmeNames)
            if (ReadText(Path.Combine(repoRoot, name)) is { } text)
                return text.Length > chars ? text[..chars] : text;
        return null;
    }

    /// <summary>UTF-8 text with universal newlines (like Python's read_text), or null when unreadable.</summary>
    private static string? ReadText(string path)
    {
        try
        {
            return new UTF8Encoding(false, true).GetString(File.ReadAllBytes(path)).Replace("\r\n", "\n").Replace('\r', '\n');
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or DecoderFallbackException)
        {
            return null;
        }
    }
}
