using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>C++ analyzer over tree-sitter-cpp (also claims .h); mirrors analyzers/cpp_analyzer.py.</summary>
public sealed class CppAnalyzer : ILanguageAnalyzer
{
    private static readonly CallSpec Calls = new("call_expression", "field_expression", "field");
    private static readonly CommentStyle DocStyle = new("comment", "//", "/**", "*/", StripLineLeadingStar: true);
    private static readonly string[] ClassTypes = ["class_specifier", "struct_specifier"];

    public string Language => "cpp";

    public IReadOnlyList<string> Extensions { get; } = [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot) => null;

    private static string ScopeClassName(Node scope) =>
        scope.Type == "qualified_identifier" ? (scope.Field("name")?.Text ?? scope.Text) : scope.Text;

    private static (string? Scope, string Name)? ResolveDeclarator(Node? declarator)
    {
        if (declarator is null) return null;
        if (declarator.Type is "identifier" or "field_identifier") return (null, declarator.Text);
        if (declarator.Type == "qualified_identifier")
        {
            var scope = declarator.Field("scope");
            var name = declarator.Field("name");
            if (scope is null || name is null) return null;
            return (ScopeClassName(scope), name.Text);
        }
        return ResolveDeclarator(declarator.Field("declarator"));
    }

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Grammars.Parse("C++", source, root => ParseRoot(root, filePath));

    private IReadOnlyList<Symbol> ParseRoot(Node root, string filePath)
    {
        var module = Syntax.ModuleSymbol(root, filePath, Language, Syntax.ModuleDottedPath(filePath), new Dictionary<string, string>());
        var symbols = new List<Symbol> { module };
        var typeIds = new Dictionary<string, string>();

        void Visit(Node node, string? enclosing, string parentId)
        {
            foreach (var child in node.Children)
            {
                if (ClassTypes.Contains(child.Type))
                {
                    if (child.Field("name") is null) continue;
                    var calls = new List<string>();
                    Syntax.CollectCalls(child, calls, Calls);
                    var symbol = Syntax.ClassSymbol(child, filePath, Language, enclosing, parentId, calls,
                        Syntax.LeadingDocComment(child, DocStyle));
                    symbols.Add(symbol);
                    typeIds[symbol.Name] = symbol.Id;
                    if (child.Field("body") is { } body) Visit(body, symbol.QualifiedName, symbol.Id);
                }
                else if (child.Type == "function_definition")
                {
                    if (ResolveDeclarator(child.Field("declarator")) is not { } resolved) continue;
                    var (scopeName, fnName) = resolved;
                    string fnParent, qualname;
                    if (scopeName is not null)
                    {
                        fnParent = typeIds.GetValueOrDefault(scopeName) ?? parentId;
                        qualname = $"{scopeName}.{fnName}";
                    }
                    else
                    {
                        fnParent = parentId;
                        qualname = !string.IsNullOrEmpty(enclosing) ? $"{enclosing}.{fnName}" : fnName;
                    }
                    var calls = new List<string>();
                    var fnBody = child.Field("body");
                    var statements = new List<BodyStatement>();
                    if (fnBody is not null)
                    {
                        Syntax.CollectCalls(fnBody, calls, Calls);
                        statements = Syntax.BodyStatements(fnBody);
                    }
                    symbols.Add(Syntax.FunctionSymbol(child, filePath, Language, fnName, qualname, fnParent, calls, statements,
                        docstring: Syntax.LeadingDocComment(child, DocStyle)));
                }
                else Visit(child, enclosing, parentId);
            }
        }

        Visit(root, null, module.Id);
        return symbols;
    }
}
