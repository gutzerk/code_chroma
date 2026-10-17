using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>C analyzer over tree-sitter-c (claims only .c, never .h); mirrors analyzers/c_analyzer.py.</summary>
public sealed class CAnalyzer : ILanguageAnalyzer
{
    private static readonly CallSpec Calls = new("call_expression", "field_expression", "field");
    private static readonly CommentStyle DocStyle = new("comment", "//", "/**", "*/", StripLineLeadingStar: true);
    private static readonly string[] NameTypes = ["identifier", "field_identifier"];

    public string Language => "c";

    public IReadOnlyList<string> Extensions { get; } = [".c"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot) => null;

    /// <summary>Descends through pointer/function declarator wrappers to the bare name.</summary>
    public static string? FunctionDeclaratorName(Node? declarator)
    {
        if (declarator is null) return null;
        if (NameTypes.Contains(declarator.Type)) return declarator.Text;
        return FunctionDeclaratorName(declarator.Field("declarator"));
    }

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Grammars.Parse("C", source, root => ParseRoot(root, filePath));

    private IReadOnlyList<Symbol> ParseRoot(Node root, string filePath)
    {
        var module = Syntax.ModuleSymbol(root, filePath, Language, Syntax.ModuleDottedPath(filePath), new Dictionary<string, string>());
        var symbols = new List<Symbol> { module };
        foreach (var node in root.Children)
        {
            if (node.Type != "function_definition") continue;
            var name = FunctionDeclaratorName(node.Field("declarator"));
            if (name is null) continue;
            var calls = new List<string>();
            var body = node.Field("body");
            var statements = new List<BodyStatement>();
            if (body is not null)
            {
                Syntax.CollectCalls(body, calls, Calls);
                statements = Syntax.BodyStatements(body);
            }
            symbols.Add(Syntax.FunctionSymbol(node, filePath, Language, name, name, module.Id, calls, statements,
                docstring: Syntax.LeadingDocComment(node, DocStyle)));
        }
        return symbols;
    }
}
