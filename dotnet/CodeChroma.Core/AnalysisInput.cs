namespace CodeChroma.Core;

/// <summary>One repo file: its parsed symbols, or null for a file no analyzer could parse.</summary>
public sealed record FileSymbols(string Path, IReadOnlyList<Symbol>? Symbols);

/// <summary>The analyzer-output JSON contract (schema_version 1): what the Python analyzers hand the core.</summary>
public sealed record AnalysisInput
{
    public int SchemaVersion { get; init; }
    public IReadOnlyList<FileSymbols> Files { get; init; } = [];
    /// <summary>Importer file, then dotted import text, then the repo path (file or directory) it resolves to.</summary>
    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> ImportResolutions { get; init; } =
        new Dictionary<string, IReadOnlyDictionary<string, string>>();
    public IReadOnlyDictionary<string, string> Summaries { get; init; } = new Dictionary<string, string>();
}

public sealed class UnsupportedSchemaException(int found) : Exception($"unsupported analysis input schema_version {found}");

public static class AnalysisInputReader
{
    public const int SupportedSchemaVersion = 1;

    public static AnalysisInput Parse(string json) => throw new NotImplementedException();

    public static AnalysisInput Load(string path) => Parse(File.ReadAllText(path));
}

/// <summary>Answers what repo path an import resolves to, standing in for the analyzer port's resolve_import.</summary>
public interface IImportResolver
{
    string? Resolve(string importerFile, string dotted);
}

public sealed class TableImportResolver(
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> table) : IImportResolver
{
    public string? Resolve(string importerFile, string dotted) =>
        table.TryGetValue(importerFile, out var perFile) && perFile.TryGetValue(dotted, out var target) ? target : null;
}
