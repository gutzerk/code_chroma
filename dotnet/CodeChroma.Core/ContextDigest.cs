using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Tomlyn;
using Tomlyn.Model;

namespace CodeChroma.Core;

/// <summary>Port of context/digest.py: the token-efficient project summary the C1 diagram author reads.</summary>
public static partial class ContextDigest
{
    public const int ReadmeExcerptChars = 1500;

    // Excluded so common stdlib noise doesn't dominate the digest -- not exhaustive, just cheap trimming.
    private static readonly HashSet<string> StdlibDenylist =
    [
        "os", "sys", "re", "io", "json", "typing", "pathlib", "collections", "dataclasses",
        "functools", "itertools", "logging", "subprocess", "shutil", "threading", "asyncio",
        "contextlib", "hashlib", "uuid", "datetime", "argparse", "socket", "signal", "time",
        "abc", "enum", "copy", "math", "random", "string", "textwrap", "traceback", "warnings",
        "unittest", "importlib", "inspect", "tempfile", "glob", "csv",
    ];

    private static readonly string[] RequirementSeparators = [" ", "(", ">", "<", "=", "!", "~", "[", ";"];
    private static readonly string[] ReadmeNames = ["README.md", "readme.md", "README.rst", "README.txt"];

    [GeneratedRegex(@"/v\d+$")]
    private static partial Regex GoVersionSuffix();

    [GeneratedRegex(@"^require\s*\($")]
    private static partial Regex GoRequireBlockStart();

    [GeneratedRegex(@"^require\s+(\S+)")]
    private static partial Regex GoRequireSingleLine();

    public static JsonObject Build(Graph graph, string repoRoot)
    {
        var knownNames = graph.NodeList
            .Where(n => n.Level is HierarchyLevel.System or HierarchyLevel.Pillar)
            .Select(n => n.Name).ToHashSet(StringComparer.Ordinal);

        return new JsonObject
        {
            ["repo_name"] = Path.GetFileName(Path.GetFullPath(repoRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)),
            ["external_import_roots"] = ExternalImportRoots(graph, knownNames),
            ["declared_dependencies"] = new JsonArray(DeclaredDependencies(repoRoot).Select(n => (JsonNode)JsonValue.Create(n)!).ToArray()),
            ["readme_excerpt"] = ReadmeExcerpt(repoRoot),
        };
    }

    private static JsonArray ExternalImportRoots(Graph graph, HashSet<string> knownNames)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var symbol in graph.SymbolList)
        {
            foreach (var dotted in symbol.Imports.Values)
            {
                var dot = dotted.IndexOf('.', StringComparison.Ordinal);
                var root = dot < 0 ? dotted : dotted[..dot];
                if (root.Length == 0 || knownNames.Contains(root) || StdlibDenylist.Contains(root)) continue;
                counts[root] = counts.GetValueOrDefault(root) + 1;
            }
        }
        // LINQ's OrderBy is stable, matching Python's sorted() on first-seen order for ties.
        return new JsonArray(counts.OrderByDescending(kv => kv.Value)
            .Select(kv => (JsonNode)new JsonObject { ["root"] = kv.Key, ["count"] = kv.Value }).ToArray());
    }

    private static List<string> DeclaredDependencies(string repoRoot)
    {
        var names = new List<string>();
        var pyproject = Path.Combine(repoRoot, "pyproject.toml");
        if (File.Exists(pyproject)) names.AddRange(PyprojectDependencies(pyproject));

        var packageJson = Path.Combine(repoRoot, "package.json");
        if (File.Exists(packageJson)) names.AddRange(PackageJsonDependencies(packageJson));

        names.AddRange(GoModDependencies(repoRoot));
        return names;
    }

    private static IEnumerable<string> PyprojectDependencies(string path)
    {
        try
        {
            var data = TomlSerializer.Deserialize<TomlTable>(File.ReadAllText(path, Encoding.UTF8));
            if (data is not null && data.TryGetValue("project", out var project) && project is TomlTable projectTable
                && projectTable.TryGetValue("dependencies", out var deps) && deps is TomlArray array)
                return array.OfType<string>().Select(DependencyName).ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or TomlException or InvalidOperationException) { }
        return [];
    }

    private static IEnumerable<string> PackageJsonDependencies(string path)
    {
        try
        {
            if (JsonNode.Parse(File.ReadAllText(path, Encoding.UTF8)) is JsonObject root
                && root["dependencies"] is JsonObject deps)
                return deps.Select(kv => kv.Key).ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { }
        return [];
    }

    /// <summary>Module paths from go.mod's require directives -- go.mod isn't TOML/JSON, parsed by line.</summary>
    private static List<string> GoModDependencies(string repoRoot)
    {
        var text = ReadText(Path.Combine(repoRoot, "go.mod"));
        if (text is null) return [];

        var names = new List<string>();
        var inRequireBlock = false;
        foreach (var line in text.Split('\n'))
        {
            var comment = line.IndexOf("//", StringComparison.Ordinal);
            var stripped = (comment < 0 ? line : line[..comment]).Trim();
            if (stripped.Length == 0) continue;
            if (inRequireBlock)
            {
                if (stripped == ")") inRequireBlock = false;
                else names.Add(GoModuleName(stripped.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)[0]));
            }
            else if (GoRequireBlockStart().IsMatch(stripped)) inRequireBlock = true;
            else if (GoRequireSingleLine().Match(stripped) is { Success: true } single) names.Add(GoModuleName(single.Groups[1].Value));
        }
        return names;
    }

    private static string GoModuleName(string modulePath) => GoVersionSuffix().Replace(modulePath, "");

    /// <summary>The bare package name from a requirement string, e.g. "fastapi (&gt;=0.1)" -> "fastapi".</summary>
    private static string DependencyName(string requirement)
    {
        foreach (var sep in RequirementSeparators)
        {
            var at = requirement.IndexOf(sep, StringComparison.Ordinal);
            if (at >= 0) requirement = requirement[..at];
        }
        return requirement.Trim();
    }

    private static string? ReadmeExcerpt(string repoRoot)
    {
        foreach (var name in ReadmeNames)
        {
            var text = ReadText(Path.Combine(repoRoot, name));
            if (text is not null) return TakeCodePoints(text, ReadmeExcerptChars);
        }
        return null;
    }

    /// <summary>Python slices by code point; this keeps a surrogate pair whole at the cut.</summary>
    private static string TakeCodePoints(string text, int count)
    {
        var index = 0;
        for (var seen = 0; seen < count && index < text.Length; seen++)
            index += char.IsHighSurrogate(text[index]) && index + 1 < text.Length ? 2 : 1;
        return text[..index];
    }

    private static string? ReadText(string path)
    {
        try
        {
            // Python's text-mode read folds CRLF and lone CR to LF, so the excerpt does too.
            return new UTF8Encoding(false, true).GetString(File.ReadAllBytes(path)).Replace("\r\n", "\n").Replace('\r', '\n');
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or DecoderFallbackException)
        {
            return null;
        }
    }
}
