using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>Go analyzer over tree-sitter-go; mirrors analyzers/go_analyzer.py.</summary>
public sealed class GoAnalyzer : ILanguageAnalyzer
{
    private static readonly CallSpec Calls = new("call_expression", "selector_expression", "field", "operand");
    private static readonly CommentStyle DocStyle = new("comment", "//");

    public string Language => "go";

    public IReadOnlyList<string> Extensions { get; } = [".go"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot)
    {
        var importerDir = Syntax.ParentPosix(importerFile.Replace('\\', '/'));
        var gomod = Syntax.FindAncestorFile(importerDir, repoRoot, "go.mod");
        if (gomod is null) return null;
        var moduleName = ReadModuleName(Path.Combine(repoRoot, gomod.Replace('/', Path.DirectorySeparatorChar)));
        if (string.IsNullOrEmpty(moduleName)) return null;
        string relDir;
        if (importText == moduleName) relDir = "";
        else if (importText.StartsWith(moduleName + "/", StringComparison.Ordinal)) relDir = importText[(moduleName.Length + 1)..];
        else return null;
        var candidate = Syntax.ConfinedRelPath(Syntax.JoinPosix(Syntax.ParentPosix(gomod), relDir));
        if (candidate is null) return null;
        return Directory.Exists(Path.Combine(repoRoot, candidate.Replace('/', Path.DirectorySeparatorChar))) ? candidate : null;
    }

    private static string? ReadModuleName(string gomodPath)
    {
        foreach (var line in Syntax.SplitLines(File.ReadAllText(gomodPath)))
        {
            var stripped = Syntax.PyStrip(line);
            if (stripped.StartsWith("module ", StringComparison.Ordinal)) return Syntax.PyStrip(stripped["module ".Length..]);
        }
        return null;
    }

    private static bool IsExported(string name) => name.Length > 0 && char.IsUpper(name, 0);

    private static List<BodyStatement> GoBodyStatements(Node block) =>
        Syntax.BodyStatements(block.Children.FirstOrDefault(c => c.Type == "statement_list") ?? block);

    private static Node? FindFirst(Node node, string type)
    {
        if (node.Type == type) return node;
        foreach (var child in node.Children)
            if (FindFirst(child, type) is { } found) return found;
        return null;
    }

    private static string? ReceiverTypeName(Node method) =>
        method.Field("receiver") is { } receiver ? FindFirst(receiver, "type_identifier")?.Text : null;

    private static void CollectByType(Node node, string type, List<Node> output)
    {
        if (node.Type == type) { output.Add(node); return; }
        foreach (var child in node.Children) CollectByType(child, type, output);
    }

    private static Dictionary<string, string> ParseImports(Node root)
    {
        var imports = new Dictionary<string, string>();
        foreach (var node in root.Children)
        {
            if (node.Type != "import_declaration") continue;
            var specs = new List<Node>();
            CollectByType(node, "import_spec", specs);
            foreach (var spec in specs)
            {
                var path = spec.Field("path") is { } p ? p.Text.Trim('\'', '"', '`') : "";
                if (path.Length == 0) continue;
                var alias = spec.Field("name");
                var local = alias is not null ? alias.Text : path[(path.LastIndexOf('/') + 1)..];
                imports[local] = path;
            }
        }
        return imports;
    }

    private static List<Node> ExpressionListItems(Node? node)
    {
        if (node is null) return [];
        var children = node.Type == "expression_list" ? node.Children : [node];
        return children.Where(c => c.IsNamed).ToList();
    }

    private static void CollectAssignedIdentifiers(Node node, List<string> output)
    {
        if (node.Type is "assignment_statement" or "short_var_declaration")
            foreach (var target in ExpressionListItems(node.Field("left")))
                if (target.Type == "identifier") output.Add(target.Text);
        foreach (var child in node.Children) CollectAssignedIdentifiers(child, output);
    }

    private static string? TypeName(Node? typeNode)
    {
        if (typeNode is null) return null;
        return typeNode.Type switch
        {
            "type_identifier" => typeNode.Text,
            "pointer_type" => TypeName(typeNode.Children.FirstOrDefault(c => c.IsNamed)),
            "qualified_type" => typeNode.Field("name")?.Text,
            _ => null,
        };
    }

    private IEnumerable<Symbol> PackagePointerVars(Node root, string filePath, string moduleId)
    {
        foreach (var node in root.Children)
        {
            if (node.Type != "var_declaration") continue;
            var specs = new List<Node>();
            CollectByType(node, "var_spec", specs);
            foreach (var spec in specs)
            {
                var nameNode = spec.Field("name");
                var typeNode = spec.Field("type");
                if (nameNode is null || typeNode is null || typeNode.Type != "pointer_type") continue;
                var name = nameNode.Text;
                var pointee = TypeName(typeNode);
                yield return new Symbol
                {
                    Id = $"{filePath}::variable::{name}", FilePath = filePath, Kind = SymbolKind.Variable, Name = name,
                    QualifiedName = name, StartLine = spec.StartLine(), EndLine = spec.EndLine(), Language = Language,
                    ParentSymbolId = moduleId, References = !string.IsNullOrEmpty(pointee) ? [pointee] : [],
                };
            }
        }
    }

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Grammars.Parse("Go", source, root => ParseRoot(root, filePath));

    private IReadOnlyList<Symbol> ParseRoot(Node root, string filePath)
    {
        var dotted = Syntax.ModuleDottedPath(filePath);
        var moduleDoc = Syntax.LeadingDocComment(root.Children.FirstOrDefault(c => c.Type == "package_clause"), DocStyle);
        var module = Syntax.ModuleSymbol(root, filePath, Language, dotted, ParseImports(root), moduleDoc);
        var symbols = new List<Symbol> { module };
        symbols.AddRange(PackagePointerVars(root, filePath, module.Id));
        var typeIds = new Dictionary<string, string>();

        foreach (var node in root.Children)
        {
            if (node.Type != "type_declaration") continue;
            var typeDoc = Syntax.LeadingDocComment(node, DocStyle);
            foreach (var spec in node.Children)
            {
                if (spec.Type != "type_spec") continue;
                var nameNode = spec.Field("name");
                if (nameNode is null) continue;
                var name = nameNode.Text;
                var typeId = $"{filePath}::class::{name}";
                typeIds[name] = typeId;
                var calls = new List<string>();
                Syntax.CollectCalls(spec, calls, Calls);
                symbols.Add(new Symbol
                {
                    Id = typeId, FilePath = filePath, Kind = SymbolKind.Class, Name = name, QualifiedName = name,
                    StartLine = spec.StartLine(), EndLine = spec.EndLine(), Language = Language, ParentSymbolId = module.Id,
                    References = calls, Docstring = typeDoc, IsExported = IsExported(name),
                });
            }
        }

        foreach (var node in root.Children)
        {
            if (node.Type is not ("function_declaration" or "method_declaration")) continue;
            var nameNode = node.Field("name");
            if (nameNode is null) continue;
            var name = nameNode.Text;
            var receiverType = node.Type == "method_declaration" ? ReceiverTypeName(node) : null;
            var qualname = !string.IsNullOrEmpty(receiverType) ? $"{receiverType}.{name}" : name;
            var calls = new List<string>();
            var qualified = new List<QualifiedReference>();
            var assigned = new List<string>();
            var body = node.Field("body");
            var statements = body is not null ? GoBodyStatements(body) : [];
            if (body is not null)
            {
                Syntax.CollectCalls(body, calls, Calls, qualified);
                CollectAssignedIdentifiers(body, assigned);
            }
            var parentId = typeIds.GetValueOrDefault(receiverType ?? "") ?? module.Id;
            symbols.Add(Syntax.FunctionSymbol(node, filePath, Language, name, qualname, parentId, calls, statements,
                assigned, Syntax.LeadingDocComment(node, DocStyle), IsExported(name), qualified));
        }
        return symbols;
    }
}
