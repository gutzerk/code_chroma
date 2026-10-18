using Tomlyn;
using Tomlyn.Model;
using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>Python analyzer over tree-sitter-python; mirrors analyzers/python_analyzer.py.</summary>
public sealed class PythonAnalyzer : ILanguageAnalyzer
{
    private static readonly CallSpec Calls = new("call", "attribute", "attribute", "object");

    public string Language => "python";

    public IReadOnlyList<string> Extensions { get; } = [".py"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot) =>
        ResolvePythonImport(importText, importerFile, repoRoot);

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Grammars.Parse("Python", source, root => ParseRoot(root, filePath));

    private IReadOnlyList<Symbol> ParseRoot(Node root, string filePath)
    {
        var dotted = Syntax.ModuleDottedPath(filePath, stripInit: true);
        var module = Syntax.ModuleSymbol(root, filePath, Language, dotted, ParseImports(root), Syntax.LeadingDocstring(root));
        var symbols = new List<Symbol> { module };

        void Visit(Node node, string? enclosing, string parentId)
        {
            foreach (var child in node.Children)
            {
                if (child.Type == "class_definition")
                {
                    var calls = new List<string>();
                    var qualified = new List<QualifiedReference>();
                    Syntax.CollectCalls(child, calls, Calls, qualified);
                    var symbol = Syntax.ClassSymbol(child, filePath, Language, enclosing, parentId, calls,
                        Syntax.LeadingDocstring(child.Field("body")), qualifiedCalls: qualified);
                    symbols.Add(symbol);
                    Visit(child, symbol.QualifiedName, symbol.Id);
                }
                else if (child.Type == "function_definition")
                {
                    var name = child.Field("name")?.Text ?? "<anonymous>";
                    var qualname = !string.IsNullOrEmpty(enclosing) ? $"{enclosing}.{name}" : name;
                    var funcId = $"{filePath}::function::{qualname}";
                    var calls = new List<string>();
                    var qualified = new List<QualifiedReference>();
                    var body = child.Field("body");
                    var statements = body is not null ? Syntax.BodyStatements(body, StatementType) : [];
                    if (body is not null) Syntax.CollectCalls(body, calls, Calls, qualified);
                    symbols.Add(Syntax.FunctionSymbol(child, filePath, Language, name, qualname, parentId, calls, statements,
                        docstring: Syntax.LeadingDocstring(body), qualifiedReferences: qualified));
                    Visit(child, qualname, funcId);
                }
                else Visit(child, enclosing, parentId);
            }
        }

        Visit(root, null, module.Id);
        symbols.AddRange(ModuleLevelVariables(root, filePath, module.Id, dotted));
        return symbols;
    }

    private static readonly HashSet<string> NonExpressionStatements =
    [
        "future_import_statement", "import_statement", "import_from_statement", "print_statement", "assert_statement",
        "expression_statement", "return_statement", "delete_statement", "raise_statement", "pass_statement",
        "break_statement", "continue_statement", "global_statement", "nonlocal_statement", "exec_statement",
        "type_alias_statement", "if_statement", "while_statement", "for_statement", "try_statement", "with_statement",
        "function_definition", "class_definition", "decorated_definition", "match_statement", "comment", "ERROR",
    ];

    /// <summary>The packaged grammar inlines expression_statement, so bare expressions report the old wrapper's type.</summary>
    private static string StatementType(Node node) => NonExpressionStatements.Contains(node.Type) ? node.Type : "expression_statement";

    private static Dictionary<string, string> ParseImports(Node root)
    {
        var imports = new Dictionary<string, string>();
        foreach (var node in root.Children)
        {
            if (node.Type == "import_from_statement")
            {
                var moduleNode = node.Field("module_name");
                var module = moduleNode?.Text ?? "";
                foreach (var child in node.Children)
                {
                    var isModule = moduleNode is not null && child.StartIndex == moduleNode.StartIndex && child.EndIndex == moduleNode.EndIndex;
                    if ((child.Type is "dotted_name" or "identifier") && !isModule) imports[child.Text] = module;
                    else if (child.Type == "aliased_import" && child.Field("name") is not null && child.Field("alias") is { } alias)
                        imports[alias.Text] = module;
                }
            }
            else if (node.Type == "import_statement")
            {
                foreach (var child in node.Children)
                {
                    if (child.Type is "dotted_name" or "identifier") imports[child.Text] = child.Text;
                    else if (child.Type == "aliased_import" && child.Field("name") is { } name && child.Field("alias") is { } alias)
                        imports[alias.Text] = name.Text;
                }
            }
        }
        return imports;
    }

    private static List<string> AssignmentTargets(Node left) => left.Type switch
    {
        "identifier" => [left.Text],
        "pattern_list" => left.Children.Where(c => c.Type == "identifier").Select(c => c.Text).ToList(),
        _ => [],
    };

    private IEnumerable<Symbol> ModuleLevelVariables(Node root, string filePath, string moduleId, string dotted)
    {
        foreach (var stmt in root.Children)
        {
            var assignment = stmt.Type == "expression_statement" && stmt.Children.Count > 0 ? stmt.Children[0] : stmt;
            if (assignment.Type != "assignment") continue;
            var left = assignment.Field("left");
            if (left is null) continue;
            foreach (var name in AssignmentTargets(left))
            {
                yield return new Symbol
                {
                    Id = $"{filePath}::variable::{name}",
                    FilePath = filePath,
                    Kind = SymbolKind.Variable,
                    Name = name,
                    QualifiedName = dotted.Length > 0 ? $"{dotted}.{name}" : name,
                    StartLine = stmt.StartLine(),
                    EndLine = stmt.EndLine(),
                    Language = Language,
                    ParentSymbolId = moduleId,
                };
            }
        }
    }

    // ---- import resolution --------------------------------------------------------------

    private static string? PoetryPackageRoot(string repoRoot, string pyprojectRel, string pyprojectDirRel, string dottedFirst)
    {
        try
        {
            var text = File.ReadAllText(Path.Combine(repoRoot, pyprojectRel.Replace('/', Path.DirectorySeparatorChar)));
            var data = TomlSerializer.Deserialize<TomlTable>(text);
            if (data is not null && data.TryGetValue("tool", out var tool) && tool is TomlTable toolTable
                && toolTable.TryGetValue("poetry", out var poetry) && poetry is TomlTable poetryTable
                && poetryTable.TryGetValue("packages", out var packages) && packages is TomlArray array)
            {
                foreach (var entry in array)
                {
                    if (entry is TomlTable table && table.TryGetValue("include", out var include) && include as string == dottedFirst)
                    {
                        var from = table.TryGetValue("from", out var f) ? f as string : null;
                        return !string.IsNullOrEmpty(from) ? Syntax.JoinPosix(pyprojectDirRel, from) : pyprojectDirRel;
                    }
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or TomlException or InvalidOperationException) { }
        return pyprojectDirRel;
    }

    private static string? CandidateModuleFile(string repoRoot, string moduleStem)
    {
        if (Syntax.ConfinedRelPath(moduleStem) is null) return null;
        var pyFile = $"{moduleStem}.py";
        if (Syntax.IsFile(repoRoot, pyFile)) return pyFile;
        var initFile = Syntax.JoinPosix(moduleStem, "__init__.py");
        return Syntax.IsFile(repoRoot, initFile) ? initFile : null;
    }

    private static string? ResolvePythonImport(string importText, string importerFile, string repoRoot)
    {
        var importerDir = Syntax.ParentPosix(importerFile.Replace('\\', '/'));
        var pyproject = Syntax.FindAncestorFile(importerDir, repoRoot, "pyproject.toml");

        if (importText.StartsWith('.'))
        {
            var level = importText.Length - importText.TrimStart('.').Length;
            var remainder = importText[level..];
            var baseDir = importerDir;
            for (var i = 0; i < level - 1; i++) baseDir = Syntax.ParentPosix(baseDir);
            if (remainder.Length == 0)
            {
                var initFile = Syntax.ConfinedRelPath(Syntax.JoinPosix(baseDir, "__init__.py"));
                return initFile is not null && Syntax.IsFile(repoRoot, initFile) ? initFile : null;
            }
            return CandidateModuleFile(repoRoot, Syntax.JoinPosix(baseDir, remainder.Split('.')));
        }

        var parts = importText.Split('.').Where(p => p.Length > 0).ToArray();
        if (parts.Length == 0) return null;
        var packageRoot = ".";
        if (pyproject is not null)
            packageRoot = PoetryPackageRoot(repoRoot, pyproject, Syntax.ParentPosix(pyproject), parts[0]) ?? ".";
        return CandidateModuleFile(repoRoot, Syntax.JoinPosix(packageRoot, parts));
    }
}
