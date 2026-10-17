using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Tomlyn;
using Tomlyn.Model;

namespace CodeChroma.Core;

/// <summary>A token-efficient project digest (external imports, declared dependencies, README) for the C1 diagram.</summary>
public static partial class ContextDigest
{
    private const int ReadmeExcerptChars = 1500;

    private static readonly HashSet<string> StdlibDenylist =
    [
        "os", "sys", "re", "io", "json", "typing", "pathlib", "collections", "dataclasses",
        "functools", "itertools", "logging", "subprocess", "shutil", "threading", "asyncio",
        "contextlib", "hashlib", "uuid", "datetime", "argparse", "socket", "signal", "time",
        "abc", "enum", "copy", "math", "random", "string", "textwrap", "traceback", "warnings",
        "unittest", "importlib", "inspect", "tempfile", "glob", "csv",
    ];

    private static readonly string[] RequirementSeparators = [" ", "(", ">", "<", "=", "!", "~", "[", ";"];

    [GeneratedRegex(@"/v\d+$")]
    private static partial Regex GoVersionSuffix();

    [GeneratedRegex(@"^require\s*\($")]
    private static partial Regex GoRequireBlockStart();

    [GeneratedRegex(@"^require\s+(\S+)")]
    private static partial Regex GoRequireSingleLine();

    public static JsonObject Build(Graph graph, string repoRoot)
    {
        var known = graph.NodeList
            .Where(n => n.Level is HierarchyLevel.System or HierarchyLevel.Pillar).Select(n => n.Name).ToHashSet();
        return new JsonObject
        {
            ["repo_name"] = Path.GetFileName(Path.GetFullPath(repoRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)),
            ["external_import_roots"] = ExternalImportRoots(graph, known),
            ["declared_dependencies"] = new JsonArray(DeclaredDependencies(repoRoot).Select(d => (JsonNode)JsonValue.Create(d)!).ToArray()),
            ["readme_excerpt"] = ReadmeExcerpt(repoRoot),
        };
    }

    private static JsonArray ExternalImportRoots(Graph graph, HashSet<string> known)
    {
        var roots = new Counter();
        foreach (var symbol in graph.SymbolList)
            foreach (var dotted in symbol.Imports.Values)
            {
                var dot = dotted.IndexOf('.');
                var root = dot < 0 ? dotted : dotted[..dot];
                if (root.Length > 0 && !known.Contains(root) && !StdlibDenylist.Contains(root)) roots.Add(root);
            }
        return new JsonArray(roots.Items.OrderByDescending(kv => kv.Value)
            .Select(kv => (JsonNode)new JsonObject { ["root"] = kv.Key, ["count"] = kv.Value }).ToArray());
    }

    private static List<string> DeclaredDependencies(string repoRoot)
    {
        var names = new List<string>();
        var pyproject = ReadText(Path.Combine(repoRoot, "pyproject.toml"));
        if (pyproject is not null) names.AddRange(PyprojectDependencies(pyproject));

        var packageJson = ReadText(Path.Combine(repoRoot, "package.json"));
        if (packageJson is not null) names.AddRange(PackageJsonDependencies(packageJson));

        names.AddRange(GoModDependencies(repoRoot));
        return names;
    }

    private static IEnumerable<string> PyprojectDependencies(string text)
    {
        try
        {
            var model = TomlSerializer.Deserialize<TomlTable>(text);
            if (model is not null && model.TryGetValue("project", out var project) && project is TomlTable table
                && table.TryGetValue("dependencies", out var deps) && deps is TomlArray array)
                return array.OfType<string>().Select(DependencyName).ToList();
        }
        catch (TomlException)
        {
        }
        return [];
    }

    private static IEnumerable<string> PackageJsonDependencies(string text)
    {
        try
        {
            return (JsonNode.Parse(text) as JsonObject)?["dependencies"] is JsonObject deps ? deps.Select(p => p.Key).ToList() : [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>Module paths from go.mod's require directives; go.mod is neither TOML nor JSON, so it is parsed by line.</summary>
    private static List<string> GoModDependencies(string repoRoot)
    {
        var text = ReadText(Path.Combine(repoRoot, "go.mod"));
        var names = new List<string>();
        if (text is null) return names;

        var inBlock = false;
        foreach (var line in text.Split('\n'))
        {
            var cut = line.IndexOf("//", StringComparison.Ordinal);
            var stripped = (cut < 0 ? line : line[..cut]).Trim();
            if (stripped.Length == 0) continue;
            if (inBlock)
            {
                if (stripped == ")") inBlock = false;
                else names.Add(GoModuleName(stripped.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)[0]));
            }
            else if (GoRequireBlockStart().IsMatch(stripped)) inBlock = true;
            else if (GoRequireSingleLine().Match(stripped) is { Success: true } single) names.Add(GoModuleName(single.Groups[1].Value));
        }
        return names;
    }

    private static string GoModuleName(string modulePath) => GoVersionSuffix().Replace(modulePath, "");

    /// <summary>The bare package name from a requirement string, e.g. "fastapi (>=0.1)" gives "fastapi".</summary>
    private static string DependencyName(string requirement)
    {
        foreach (var separator in RequirementSeparators)
        {
            var at = requirement.IndexOf(separator, StringComparison.Ordinal);
            if (at >= 0) requirement = requirement[..at];
        }
        return requirement.Trim();
    }

    private static string? ReadmeExcerpt(string repoRoot)
    {
        foreach (var name in new[] { "README.md", "readme.md", "README.rst", "README.txt" })
        {
            var text = ReadText(Path.Combine(repoRoot, name));
            if (text is not null) return text.Length > ReadmeExcerptChars ? text[..ReadmeExcerptChars] : text;
        }
        return null;
    }

    /// <summary>File contents with universal newlines, or null when unreadable or not valid UTF-8.</summary>
    private static string? ReadText(string path)
    {
        try
        {
            var text = new UTF8Encoding(false, true).GetString(File.ReadAllBytes(path));
            return text.Replace("\r\n", "\n").Replace('\r', '\n');
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or DecoderFallbackException)
        {
            return null;
        }
    }
}
