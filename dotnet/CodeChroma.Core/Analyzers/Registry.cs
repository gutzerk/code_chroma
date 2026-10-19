using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>Parses one source file into the symbols it defines; the C# port of the Python LanguageAnalyzer port.</summary>
public interface ILanguageAnalyzer
{
    string Language { get; }

    IReadOnlyList<string> Extensions { get; }

    IReadOnlyList<Symbol> Parse(string filePath, string source);

    /// <summary>Repo-relative path an import resolves to on disk; null if unresolved or not local.</summary>
    string? ResolveImport(string importText, string importerFile, string repoRoot);
}

/// <summary>Selects an analyzer by file extension.</summary>
public sealed class AnalyzerRegistry
{
    private readonly Dictionary<string, ILanguageAnalyzer> _byExtension = new(StringComparer.Ordinal);

    public AnalyzerRegistry(IEnumerable<ILanguageAnalyzer>? analyzers = null)
    {
        foreach (var analyzer in analyzers ?? []) Register(analyzer);
    }

    public void Register(ILanguageAnalyzer analyzer)
    {
        foreach (var ext in analyzer.Extensions) _byExtension[ext] = analyzer;
    }

    /// <summary>Case-sensitive on the extension, like pathlib's suffix lookup in Python.</summary>
    public ILanguageAnalyzer? ForFile(string filePath) =>
        _byExtension.TryGetValue(Suffix(filePath), out var analyzer) ? analyzer : null;

    public static AnalyzerRegistry WithDefaults() => new(Defaults());

    /// <summary>Every extension (with its leading dot) some registered analyzer parses.</summary>
    public IReadOnlyCollection<string> SupportedExtensions() => _byExtension.Keys;

    private static IEnumerable<ILanguageAnalyzer> Defaults()
    {
        yield return new PythonAnalyzer();
        yield return new TypeScriptAnalyzer();
        yield return new GoAnalyzer();
        yield return new JavaAnalyzer();
        yield return new CSharpAnalyzer();
        yield return new RustAnalyzer();
        yield return new PhpAnalyzer();
        yield return new RubyAnalyzer();
        yield return new CAnalyzer();
        yield return new CppAnalyzer();
        yield return new YamlAnalyzer();
    }

    /// <summary>pathlib.PurePath.suffix of the final path component.</summary>
    public static string Suffix(string filePath)
    {
        var name = filePath[(filePath.LastIndexOfAny(['/', '\\']) + 1)..];
        var dot = name.LastIndexOf('.');
        return dot <= 0 ? "" : name[dot..];
    }
}

/// <summary>Shared native-grammar handles and the parse entry point every tree-sitter analyzer uses.</summary>
public static class Grammars
{
    private static readonly Dictionary<string, Language> Cache = [];

    public static Language Get(string name)
    {
        lock (Cache)
        {
            if (!Cache.TryGetValue(name, out var language)) Cache[name] = language = new Language(name);
            return language;
        }
    }

    /// <summary>Parses with a fresh parser; the tree is disposed by the caller's <paramref name="use"/> scope.</summary>
    public static T Parse<T>(string grammar, string source, Func<Node, T> use)
    {
        using var parser = new Parser(Get(grammar));
        using var tree = parser.Parse(source) ?? throw new InvalidOperationException("tree-sitter returned no tree");
        return use(tree.RootNode);
    }
}

/// <summary>Resolves imports against the live repo tree through the analyzers, like the Python engine does on every reanalyze.</summary>
public sealed class LiveImportResolver(AnalyzerRegistry registry, string root) : IImportResolver
{
    private readonly string _root = Path.GetFullPath(root);

    public string? Resolve(string importerFile, string dotted) =>
        registry.ForFile(importerFile)?.ResolveImport(dotted, importerFile, _root);
}
