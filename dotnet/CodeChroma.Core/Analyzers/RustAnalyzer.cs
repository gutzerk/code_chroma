using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>Rust analyzer over tree-sitter-rust; mirrors analyzers/rust_analyzer.py.</summary>
public sealed class RustAnalyzer : ILanguageAnalyzer
{
    private static readonly CallSpec Calls = new("call_expression", "field_expression", "field");
    private static readonly string[] ClassTypes = ["struct_item", "enum_item", "trait_item"];
    private static readonly string[] FunctionTypes = ["function_item", "function_signature_item"];
    private static readonly CommentStyle DocStyle = new("line_comment", "///", LineOffset: 0);

    public string Language => "rust";

    public IReadOnlyList<string> Extensions { get; } = [".rs"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot) => null;

    private static string? ModuleDoc(Node root)
    {
        var lines = new List<string>();
        foreach (var child in root.Children)
        {
            if (child.Type != "line_comment") break;
            if (!child.Children.Any(c => c.Type == "inner_doc_comment_marker")) break;
            var text = child.Text;
            if (text.StartsWith("//!", StringComparison.Ordinal)) text = text[3..];
            lines.Add(Syntax.PyStrip(text));
        }
        return lines.Count > 0 ? Syntax.CleanDoc(string.Join('\n', lines)) : null;
    }

    private static string? ImplTypeName(Node impl)
    {
        var typeNode = impl.Field("type");
        if (typeNode is null) return null;
        Node? nameNode = typeNode.Type switch
        {
            "type_identifier" => typeNode,
            "generic_type" => typeNode.Field("type"),
            _ => null,
        };
        return nameNode?.Text;
    }

    private Symbol RustFunction(Node node, string filePath, string qualname, string parentId)
    {
        var name = node.Field("name")?.Text ?? qualname;
        var calls = new List<string>();
        var body = node.Field("body");
        var statements = new List<BodyStatement>();
        if (body is not null)
        {
            Syntax.CollectCalls(body, calls, Calls);
            statements = Syntax.BodyStatements(body);
        }
        return Syntax.FunctionSymbol(node, filePath, Language, name, qualname, parentId, calls, statements,
            docstring: Syntax.LeadingDocComment(node, DocStyle));
    }

    private static List<Node> FlattenItems(IEnumerable<Node> items)
    {
        var flat = new List<Node>();
        foreach (var item in items)
        {
            if (item.Type == "mod_item")
            {
                if (item.Field("body") is { } body) flat.AddRange(FlattenItems(body.Children));
            }
            else flat.Add(item);
        }
        return flat;
    }

    private void EmitMembers(Node? body, string filePath, string? prefix, string parentId, List<Symbol> symbols)
    {
        if (body is null) return;
        foreach (var member in body.Children)
        {
            if (!FunctionTypes.Contains(member.Type)) continue;
            var nameNode = member.Field("name");
            if (nameNode is null) continue;
            var mname = nameNode.Text;
            var qualname = !string.IsNullOrEmpty(prefix) ? $"{prefix}.{mname}" : mname;
            symbols.Add(RustFunction(member, filePath, qualname, parentId));
        }
    }

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Grammars.Parse("Rust", source, root => ParseRoot(root, filePath));

    private IReadOnlyList<Symbol> ParseRoot(Node root, string filePath)
    {
        var dotted = Syntax.ModuleDottedPath(filePath);
        var module = Syntax.ModuleSymbol(root, filePath, Language, dotted, new Dictionary<string, string>(), ModuleDoc(root));
        var symbols = new List<Symbol> { module };
        var typeIds = new Dictionary<string, string>();
        var items = FlattenItems(root.Children);

        foreach (var node in items)
        {
            if (!ClassTypes.Contains(node.Type)) continue;
            var calls = new List<string>();
            Syntax.CollectCalls(node, calls, Calls);
            var symbol = Syntax.ClassSymbol(node, filePath, Language, null, module.Id, calls,
                Syntax.LeadingDocComment(node, DocStyle));
            symbols.Add(symbol);
            typeIds[symbol.Name] = symbol.Id;
            if (node.Type == "trait_item") EmitMembers(node.Field("body"), filePath, symbol.Name, symbol.Id, symbols);
        }

        foreach (var node in items)
        {
            if (node.Type == "function_item")
            {
                var nameNode = node.Field("name");
                if (nameNode is null) continue;
                symbols.Add(RustFunction(node, filePath, nameNode.Text, module.Id));
            }
            else if (node.Type == "impl_item")
            {
                var typeName = ImplTypeName(node);
                var parentId = typeIds.GetValueOrDefault(typeName ?? "") ?? module.Id;
                EmitMembers(node.Field("body"), filePath, typeName, parentId, symbols);
            }
        }
        return symbols;
    }
}
