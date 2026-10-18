namespace CodeChroma.Canvas.Highlighting;

/// <summary>
/// Maps a fence language or file alias to a canonical language and its TextMate scope (the strategy selector
/// registry.ts was for Prism). The Avalonia view feeds the scope to AvaloniaEdit's TextMate installation, so the
/// per-language tokenizer files collapse into this one table.
/// </summary>
public static class LanguageRegistry
{
    public const string PlainText = "plaintext";

    private static readonly Dictionary<string, string> Aliases = BuildAliases();

    private static readonly Dictionary<string, string> Scopes = new()
    {
        ["python"] = "source.python", ["go"] = "source.go", ["java"] = "source.java", ["yaml"] = "source.yaml",
        ["typescript"] = "source.ts", ["javascript"] = "source.js", ["jsx"] = "source.js.jsx", ["tsx"] = "source.tsx",
        ["c"] = "source.c", ["cpp"] = "source.cpp", ["csharp"] = "source.cs", ["ruby"] = "source.ruby",
        ["rust"] = "source.rust", ["swift"] = "source.swift", ["kotlin"] = "source.kotlin", ["json"] = "source.json",
        ["css"] = "source.css", ["markdown"] = "text.html.markdown", ["sql"] = "source.sql", ["bash"] = "source.shell",
        ["toml"] = "source.toml", [PlainText] = "text.plain",
    };

    public static string Resolve(string? language) =>
        !string.IsNullOrEmpty(language) && Aliases.TryGetValue(language.ToLowerInvariant(), out var canonical) ? canonical : PlainText;

    public static string TextMateScope(string canonical) => Scopes.TryGetValue(canonical, out var scope) ? scope : Scopes[PlainText];

    private static Dictionary<string, string> BuildAliases()
    {
        var map = new Dictionary<string, string>();
        void Add(string canonical, params string[] aliases) { foreach (var a in aliases) map[a] = canonical; }
        Add("python", "python", "py");
        Add("go", "go", "golang");
        Add("java", "java");
        Add("yaml", "yaml", "yml");
        Add("typescript", "typescript", "ts");
        Add("javascript", "javascript", "js", "node");
        Add("jsx", "jsx", "react");
        Add("tsx", "tsx");
        Add("c", "c");
        Add("cpp", "cpp", "c++", "cxx");
        Add("csharp", "csharp", "c#", "cs");
        Add("ruby", "ruby", "rb");
        Add("rust", "rust", "rs");
        Add("swift", "swift");
        Add("kotlin", "kotlin", "kt");
        Add("json", "json");
        Add("css", "css");
        Add("markdown", "markdown", "md");
        Add("sql", "sql");
        Add("bash", "bash", "sh", "shell");
        Add("toml", "toml");
        return map;
    }
}
