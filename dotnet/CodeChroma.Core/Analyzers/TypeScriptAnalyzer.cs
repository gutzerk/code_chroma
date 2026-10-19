using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>TypeScript/JavaScript analyzer over tree-sitter-typescript; mirrors analyzers/typescript_analyzer.py.</summary>
public sealed class TypeScriptAnalyzer : ILanguageAnalyzer
{
    private static readonly CallSpec Calls = new("call_expression", "member_expression", "property", "object");
    private static readonly CommentStyle DocStyle = new("comment", "//", "/**", "*/", StripLineLeadingStar: true);
    private static readonly string[] ExportWrapperTypes = ["lexical_declaration", "export_statement"];
    private static readonly string[] TsExtensions = [".ts", ".tsx", ".js", ".jsx"];

    public string Language => "typescript";

    public IReadOnlyList<string> Extensions => TsExtensions;

    public string? ResolveImport(string importText, string importerFile, string repoRoot)
    {
        if (!(importText.StartsWith("./", StringComparison.Ordinal) || importText.StartsWith("../", StringComparison.Ordinal))) return null;
        var importerDir = Syntax.ParentPosix(importerFile.Replace('\\', '/'));
        var combined = Syntax.ConfinedRelPath(importerDir == "." ? importText : $"{importerDir}/{importText}");
        if (combined is null) return null;
        if (Syntax.IsFile(repoRoot, combined)) return combined;
        foreach (var ext in TsExtensions)
            if (Syntax.IsFile(repoRoot, combined + ext)) return combined + ext;
        foreach (var ext in TsExtensions)
            if (Syntax.IsFile(repoRoot, $"{combined}/index{ext}")) return $"{combined}/index{ext}";
        return null;
    }

    private static (Node Anchor, bool IsExported) DocAnchor(Node node)
    {
        var anchor = node;
        var exported = false;
        var parent = node.Parent;
        while (parent is not null && ExportWrapperTypes.Contains(parent.Type))
        {
            anchor = parent;
            exported = exported || parent.Type == "export_statement";
            parent = parent.Parent;
        }
        return (anchor, exported);
    }

    private static (string? Doc, bool Exported) DocFields(Node node)
    {
        var (anchor, exported) = DocAnchor(node);
        return (Syntax.LeadingDocComment(anchor, DocStyle), exported);
    }

    private static Dictionary<string, string> ParseImports(Node root)
    {
        var imports = new Dictionary<string, string>();
        foreach (var node in root.Children)
        {
            if (node.Type != "import_statement") continue;
            var sourceNode = node.Field("source");
            var module = sourceNode is not null ? sourceNode.Text.Trim('\'', '"') : "";
            foreach (var child in node.Children)
            {
                if (child.Type != "import_clause") continue;
                foreach (var nameNode in child.Children)
                {
                    if (nameNode.Type == "identifier") imports[nameNode.Text] = module;
                    else if (nameNode.Type == "named_imports")
                    {
                        foreach (var spec in nameNode.Children)
                        {
                            if (spec.Type != "import_specifier") continue;
                            var local = spec.Field("alias") ?? spec.Field("name");
                            if (local is not null) imports[local.Text] = module;
                        }
                    }
                }
            }
        }
        return imports;
    }

    private Symbol? ExtractFunction(Node node, string filePath, string? enclosing, string parentId)
    {
        var nameNode = node.Field("name");
        if (nameNode is null) return null;
        var name = nameNode.Text;
        var qualname = !string.IsNullOrEmpty(enclosing) ? $"{enclosing}.{name}" : name;
        var calls = new List<string>();
        var qualified = new List<QualifiedReference>();
        var body = node.Field("body");
        var statements = new List<BodyStatement>();
        if (body is not null)
        {
            Syntax.CollectCalls(body, calls, Calls, qualified);
            statements = Syntax.BodyStatements(body);
        }
        var (doc, exported) = DocFields(node);
        return Syntax.FunctionSymbol(node, filePath, Language, name, qualname, parentId, calls, statements,
            docstring: doc, isExported: exported, qualifiedReferences: qualified);
    }

    private Symbol? ExtractArrowFunction(Node declarator, Node arrow, string filePath, string? enclosing, string parentId)
    {
        var nameNode = declarator.Field("name");
        if (nameNode is null) return null;
        var name = nameNode.Text;
        var qualname = !string.IsNullOrEmpty(enclosing) ? $"{enclosing}.{name}" : name;
        var calls = new List<string>();
        var qualified = new List<QualifiedReference>();
        var body = arrow.Field("body");
        var statements = new List<BodyStatement>();
        if (body is not null)
        {
            Syntax.CollectCalls(body, calls, Calls, qualified);
            if (body.Type == "statement_block") statements = Syntax.BodyStatements(body);
        }
        var (doc, exported) = DocFields(declarator);
        return Syntax.FunctionSymbol(declarator, filePath, Language, name, qualname, parentId, calls, statements,
            docstring: doc, isExported: exported, qualifiedReferences: qualified);
    }

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Grammars.Parse("TypeScript", source, root => ParseRoot(root, filePath));

    private IReadOnlyList<Symbol> ParseRoot(Node root, string filePath)
    {
        var dotted = Syntax.ModuleDottedPath(filePath);
        var anchor = root.Children.FirstOrDefault(c => c.Type != "comment");
        var moduleDoc = Syntax.LeadingDocComment(anchor, DocStyle);
        var module = Syntax.ModuleSymbol(root, filePath, Language, dotted, ParseImports(root), moduleDoc);
        var symbols = new List<Symbol> { module };

        void Visit(Node node, string? enclosing, string parentId)
        {
            foreach (var child in node.Children)
            {
                if (child.Type is "function_declaration" or "method_definition")
                {
                    var symbol = ExtractFunction(child, filePath, enclosing, parentId);
                    if (symbol is not null)
                    {
                        symbols.Add(symbol);
                        Visit(child, symbol.QualifiedName, symbol.Id);
                    }
                    else Visit(child, enclosing, parentId);
                }
                else if (child.Type == "class_declaration")
                {
                    var (doc, exported) = DocFields(child);
                    var calls = new List<string>();
                    var qualified = new List<QualifiedReference>();
                    Syntax.CollectCalls(child, calls, Calls, qualified);
                    var symbol = Syntax.ClassSymbol(child, filePath, Language, enclosing, parentId, calls,
                        doc, exported, qualified);
                    symbols.Add(symbol);
                    Visit(child, symbol.QualifiedName, symbol.Id);
                }
                else if (child.Type == "variable_declarator")
                {
                    var value = child.Field("value");
                    var symbol = value is not null && value.Type == "arrow_function"
                        ? ExtractArrowFunction(child, value, filePath, enclosing, parentId)
                        : null;
                    if (symbol is not null)
                    {
                        symbols.Add(symbol);
                        Visit(value!, symbol.QualifiedName, symbol.Id);
                    }
                    else Visit(child, enclosing, parentId);
                }
                else Visit(child, enclosing, parentId);
            }
        }

        Visit(root, null, module.Id);
        return symbols;
    }
}
