using System.Text.RegularExpressions;
using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>C# analyzer over tree-sitter-c-sharp; mirrors analyzers/csharp_analyzer.py.</summary>
public sealed partial class CSharpAnalyzer : ILanguageAnalyzer
{
    private static readonly CallSpec Calls = new("invocation_expression", "member_access_expression", "name");
    private static readonly CommentStyle DocStyle = new("comment", "///");

    private static readonly TraversalSpec Spec = new(
        ["class_declaration", "interface_declaration", "struct_declaration"],
        ["method_declaration", "constructor_declaration"],
        (node, output) => Syntax.CollectCalls(node, output, Calls),
        DocFor,
        node => node.Children.Any(c => c.Type == "modifier" && c.Text == "public"));

    [GeneratedRegex("</?summary>")]
    private static partial Regex XmlTag();

    private static string? DocFor(Node node)
    {
        var doc = Syntax.LeadingDocComment(node, DocStyle);
        if (doc is null) return null;
        return string.Join('\n', Syntax.SplitLines(doc).Select(l => Syntax.PyStrip(XmlTag().Replace(l, ""))).Where(l => l.Length > 0));
    }

    public string Language => "csharp";

    public IReadOnlyList<string> Extensions { get; } = [".cs"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot) => null;

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Traversal.ParseModule("C#", source, filePath, Language, Spec);
}

/// <summary>Java analyzer over tree-sitter-java; mirrors analyzers/java_analyzer.py.</summary>
public sealed class JavaAnalyzer : ILanguageAnalyzer
{
    private static readonly CommentStyle DocStyle = new("block_comment", "", "/**", "*/", StripLineLeadingStar: true);

    private static readonly TraversalSpec Spec = new(
        ["class_declaration", "interface_declaration", "enum_declaration"],
        ["method_declaration", "constructor_declaration"],
        CollectJavaCalls,
        node => Syntax.LeadingDocComment(node, DocStyle),
        node => node.Children.FirstOrDefault(c => c.Type == "modifiers") is { } m && m.Children.Any(c => c.Type == "public"));

    private static void CollectJavaCalls(Node node, List<string> output)
    {
        if (node.Type == "method_invocation" && node.Field("name") is { } name) output.Add(name.Text);
        foreach (var child in node.Children) CollectJavaCalls(child, output);
    }

    public string Language => "java";

    public IReadOnlyList<string> Extensions { get; } = [".java"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot) => null;

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Traversal.ParseModule("Java", source, filePath, Language, Spec);
}

/// <summary>PHP analyzer over tree-sitter-php; mirrors analyzers/php_analyzer.py.</summary>
public sealed class PhpAnalyzer : ILanguageAnalyzer
{
    private static readonly CommentStyle DocStyle = new("comment", "", "/**", "*/", StripLineLeadingStar: true);

    private static readonly TraversalSpec Spec = new(
        ["class_declaration", "interface_declaration", "trait_declaration"],
        ["method_declaration", "function_definition"],
        CollectPhpCalls,
        node => Syntax.LeadingDocComment(node, DocStyle),
        node => !node.Children.Any(c => c.Type == "visibility_modifier" && c.Text == "private"));

    private static void CollectPhpCalls(Node node, List<string> output)
    {
        if (node.Type == "function_call_expression")
        {
            if (node.Field("function") is { Type: "name" } fn) output.Add(fn.Text);
        }
        else if (node.Type == "member_call_expression" && node.Field("name") is { } name) output.Add(name.Text);
        foreach (var child in node.Children) CollectPhpCalls(child, output);
    }

    public string Language => "php";

    public IReadOnlyList<string> Extensions { get; } = [".php"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot) => null;

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Traversal.ParseModule("PHP", source, filePath, Language, Spec);
}

/// <summary>Ruby analyzer over tree-sitter-ruby; mirrors analyzers/ruby_analyzer.py.</summary>
public sealed class RubyAnalyzer : ILanguageAnalyzer
{
    private static readonly CommentStyle DocStyle = new("comment", "#");

    private static readonly TraversalSpec Spec = new(
        ["class", "module"],
        ["method"],
        CollectRubyCalls,
        node => Syntax.LeadingDocComment(DocAnchor(node), DocStyle));

    /// <summary>A leading comment for the first statement in a body_statement is that wrapper's sibling.</summary>
    private static Node DocAnchor(Node node)
    {
        var anchor = node;
        while (anchor.PreviousSibling is null && anchor.Parent is { Type: "body_statement" } parent) anchor = parent;
        return anchor;
    }

    private static void CollectRubyCalls(Node node, List<string> output)
    {
        if (node.Type == "call" && node.Field("method") is { } method) output.Add(method.Text);
        foreach (var child in node.Children) CollectRubyCalls(child, output);
    }

    public string Language => "ruby";

    public IReadOnlyList<string> Extensions { get; } = [".rb"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot) => null;

    public IReadOnlyList<Symbol> Parse(string filePath, string source) =>
        Traversal.ParseModule("Ruby", source, filePath, Language, Spec);
}
