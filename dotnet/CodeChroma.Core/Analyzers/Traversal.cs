using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>Per-grammar node-type tables and hooks for the shared class/function tree walk.</summary>
public sealed record TraversalSpec(
    string[] ClassTypes,
    string[] FunctionTypes,
    Action<Node, List<string>> CollectCalls,
    Func<Node, string?> DocFor,
    Func<Node, bool>? IsExported = null);

/// <summary>The walk shared by the Java, C#, PHP and Ruby analyzers (tree_sitter_common.walk_classes_and_functions).</summary>
public static class Traversal
{
    public static List<Symbol> WalkClassesAndFunctions(Node root, string filePath, string language, string moduleId, TraversalSpec spec)
    {
        var symbols = new List<Symbol>();

        void Visit(Node node, string? enclosing, string parentId)
        {
            foreach (var child in node.Children)
            {
                if (spec.ClassTypes.Contains(child.Type))
                {
                    if (child.Field("name") is null) continue;
                    var calls = new List<string>();
                    spec.CollectCalls(child, calls);
                    var symbol = Syntax.ClassSymbol(child, filePath, language, enclosing, parentId, calls,
                        spec.DocFor(child), spec.IsExported?.Invoke(child) ?? false);
                    symbols.Add(symbol);
                    if (child.Field("body") is { } body) Visit(body, symbol.QualifiedName, symbol.Id);
                }
                else if (spec.FunctionTypes.Contains(child.Type))
                {
                    var nameNode = child.Field("name");
                    if (nameNode is null) continue;
                    var name = nameNode.Text;
                    var qualname = !string.IsNullOrEmpty(enclosing) ? $"{enclosing}.{name}" : name;
                    var calls = new List<string>();
                    var body = child.Field("body");
                    var statements = new List<BodyStatement>();
                    if (body is not null)
                    {
                        spec.CollectCalls(body, calls);
                        statements = Syntax.BodyStatements(body);
                    }
                    symbols.Add(Syntax.FunctionSymbol(child, filePath, language, name, qualname, parentId, calls, statements,
                        docstring: spec.DocFor(child), isExported: spec.IsExported?.Invoke(child) ?? false));
                }
                else Visit(child, enclosing, parentId);
            }
        }

        Visit(root, null, moduleId);
        return symbols;
    }

    public static IReadOnlyList<Symbol> ParseModule(string grammar, string source, string filePath, string language, TraversalSpec spec) =>
        Grammars.Parse(grammar, source, root =>
        {
            var module = Syntax.ModuleSymbol(root, filePath, language, Syntax.ModuleDottedPath(filePath), new Dictionary<string, string>());
            var symbols = new List<Symbol> { module };
            symbols.AddRange(WalkClassesAndFunctions(root, filePath, language, module.Id, spec));
            return (IReadOnlyList<Symbol>)symbols;
        });
}
