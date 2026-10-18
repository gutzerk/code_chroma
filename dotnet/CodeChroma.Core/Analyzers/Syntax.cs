using System.Text;
using TreeSitter;

namespace CodeChroma.Core.Analyzers;

/// <summary>Names a grammar uses for a call node and a qualified callee's trailing segment.</summary>
public sealed record CallSpec(string CallType, string MemberType, string MemberField, string? ObjectField = null);

/// <summary>Per-grammar doc-comment shape; the C# port of tree_sitter_common.CommentStyle.</summary>
public sealed record CommentStyle(
    string LineCommentType,
    string LinePrefix,
    string? BlockPrefix = null,
    string? BlockSuffix = null,
    bool StripLineLeadingStar = false,
    int LineOffset = 1);

/// <summary>The tree-sitter helpers every analyzer shares (the C# port of tree_sitter_common.py).</summary>
public static class Syntax
{
    public static Node? Field(this Node node, string name) => node.GetChildForField(name);

    public static int StartLine(this Node node) => node.StartPosition.Row + 1;

    public static int EndLine(this Node node) => node.EndPosition.Row + 1;

    public static string Text(this Node? node) => node?.Text ?? "";

    /// <summary>Dotted module name for a file path; <paramref name="stripInit"/> drops a trailing __init__ (Python).</summary>
    public static string ModuleDottedPath(string filePath, bool stripInit = false)
    {
        var parts = filePath.Replace('\\', '/').Split('/').Where(p => p.Length > 0 && p != ".").ToList();
        if (parts.Count > 0)
        {
            var last = parts[^1];
            var dot = last.LastIndexOf('.');
            if (dot > 0) parts[^1] = last[..dot];
        }
        if (stripInit && parts.Count > 0 && parts[^1] == "__init__") parts.RemoveAt(parts.Count - 1);
        return string.Join('.', parts);
    }

    /// <summary>posixpath.normpath.</summary>
    public static string NormPosix(string path)
    {
        if (path.Length == 0) return ".";
        var initialSlashes = path.StartsWith('/') ? (path.StartsWith("//") && !path.StartsWith("///") ? 2 : 1) : 0;
        var stack = new List<string>();
        foreach (var comp in path.Split('/'))
        {
            if (comp.Length == 0 || comp == ".") continue;
            if (comp != ".." || (initialSlashes == 0 && stack.Count == 0) || (stack.Count > 0 && stack[^1] == ".."))
                stack.Add(comp);
            else if (stack.Count > 0) stack.RemoveAt(stack.Count - 1);
        }
        var joined = new string('/', initialSlashes) + string.Join('/', stack);
        return joined.Length == 0 ? "." : joined;
    }

    /// <summary>Normalized path, or null if it climbs above the root it is relative to.</summary>
    public static string? ConfinedRelPath(string relativePosix)
    {
        var normalized = NormPosix(relativePosix);
        return normalized == ".." || normalized.StartsWith("../", StringComparison.Ordinal) ? null : normalized;
    }

    /// <summary>Repo-relative posix join the way pathlib does it ('.' vanishes).</summary>
    public static string JoinPosix(string left, params string[] parts)
    {
        var all = new List<string>();
        if (left.Length > 0 && left != ".") all.Add(left);
        all.AddRange(parts.Where(p => p.Length > 0 && p != "."));
        return all.Count == 0 ? "." : string.Join('/', all);
    }

    public static string ParentPosix(string path)
    {
        var slash = path.LastIndexOf('/');
        return slash < 0 ? "." : slash == 0 ? "/" : path[..slash];
    }

    public static bool IsFile(string repoRoot, string relPosix) =>
        File.Exists(Path.Combine(repoRoot, relPosix.Replace('/', Path.DirectorySeparatorChar)));

    /// <summary>Nearest file named <paramref name="filename"/> at or above <paramref name="startDirRel"/>, never above the root.</summary>
    public static string? FindAncestorFile(string startDirRel, string repoRoot, string filename)
    {
        var current = startDirRel;
        while (true)
        {
            var candidate = JoinPosix(current, filename);
            if (IsFile(repoRoot, candidate)) return candidate;
            if (current == ".") return null;
            current = ParentPosix(current);
        }
    }

    public static (string? Qualifier, string Name)? CallTargetName(Node call, CallSpec spec)
    {
        var target = call.Field("function");
        if (target is null) return null;
        if (target.Type == "identifier") return (null, target.Text);
        if (target.Type != spec.MemberType) return null;
        var segment = target.Field(spec.MemberField);
        if (segment is null) return null;
        string? qualifier = null;
        if (spec.ObjectField is not null && target.Field(spec.ObjectField) is { } obj) qualifier = obj.Text;
        return (qualifier, segment.Text);
    }

    public static void CollectCalls(Node node, List<string> output, CallSpec spec, List<QualifiedReference>? qualifiedOutput = null)
    {
        if (node.Type == spec.CallType && CallTargetName(node, spec) is { } result)
        {
            output.Add(result.Name);
            if (result.Qualifier is not null) qualifiedOutput?.Add(new QualifiedReference(result.Qualifier, result.Name));
        }
        foreach (var child in node.Children) CollectCalls(child, output, spec, qualifiedOutput);
    }

    public static List<BodyStatement> BodyStatements(Node body, Func<Node, string>? typeOf = null) =>
        body.Children.Where(c => c.IsNamed).Select(c => new BodyStatement(typeOf?.Invoke(c) ?? c.Type, c.StartLine(), c.EndLine())).ToList();

    // ---- inspect.cleandoc and friends -----------------------------------------------------

    public static string ExpandTabs(string text, int tabSize = 8)
    {
        if (!text.Contains('\t')) return text;
        var sb = new StringBuilder();
        var column = 0;
        foreach (var ch in text)
        {
            if (ch == '\t')
            {
                var n = tabSize - column % tabSize;
                sb.Append(' ', n);
                column += n;
            }
            else
            {
                sb.Append(ch);
                column = ch is '\n' or '\r' ? 0 : column + 1;
            }
        }
        return sb.ToString();
    }

    /// <summary>inspect.cleandoc (Python 3.14).</summary>
    public static string CleanDoc(string doc)
    {
        var lines = ExpandTabs(doc).Split('\n');
        var margin = int.MaxValue;
        for (var i = 1; i < lines.Length; i++)
        {
            var content = lines[i].TrimStart(' ').Length;
            if (content > 0) margin = Math.Min(margin, lines[i].Length - content);
        }
        lines[0] = lines[0].TrimStart(' ');
        if (margin < int.MaxValue)
            for (var i = 1; i < lines.Length; i++) lines[i] = margin >= lines[i].Length ? "" : lines[i][margin..];
        var end = lines.Length;
        while (end > 0 && lines[end - 1].Length == 0) end--;
        var start = 0;
        while (start < end && lines[start].Length == 0) start++;
        return string.Join('\n', lines[start..end]);
    }

    /// <summary>str.splitlines(): splits on the same line boundaries Python does.</summary>
    public static List<string> SplitLines(string text)
    {
        var result = new List<string>();
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (ch is '\n' or '\r' or '\v' or '\f' or '\x1c' or '\x1d' or '\x1e' or '\x85' or '\u2028' or '\u2029')
            {
                result.Add(text[start..i]);
                if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                start = i + 1;
            }
        }
        if (start < text.Length) result.Add(text[start..]);
        return result;
    }

    /// <summary>A bare string literal as the body's first statement, dedented, or null.</summary>
    public static string? LeadingDocstring(Node? body)
    {
        if (body is null) return null;
        var children = body.Children;
        if (children.Count == 0) return null;
        var first = children[0];
        // The packaged python grammar inlines expression_statement; the pinned Python one wraps a lone string in it.
        var stringNode = first.Type == "expression_statement" && first.Children.Count > 0 ? first.Children[0] : first;
        if (stringNode.Type != "string") return null;
        var content = stringNode.Children.FirstOrDefault(c => c.Type == "string_content");
        return content is null ? null : CleanDoc(content.Text);
    }

    private static string StripBlockComment(string text, CommentStyle style)
    {
        if (style.BlockPrefix is not null && text.StartsWith(style.BlockPrefix, StringComparison.Ordinal)) text = text[style.BlockPrefix.Length..];
        if (style.BlockSuffix is not null && text.EndsWith(style.BlockSuffix, StringComparison.Ordinal)) text = text[..^style.BlockSuffix.Length];
        var lines = SplitLines(text);
        if (style.StripLineLeadingStar)
        {
            lines = lines.Select(line =>
            {
                var t = PyStrip(line);
                if (t.StartsWith('*')) t = t[1..];
                return PyStrip(t);
            }).ToList();
        }
        return CleanDoc(string.Join('\n', lines));
    }

    /// <summary>str.strip() with Python's whitespace set.</summary>
    public static string PyStrip(string s) => s.Trim(PyWhitespace);

    private static readonly char[] PyWhitespace =
        [' ', '\t', '\n', '\r', '\v', '\f', '\x1c', '\x1d', '\x1e', '\x1f', '\x85', '\xa0', '\u1680',
         '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a',
         '\u2028', '\u2029', '\u202f', '\u205f', '\u3000'];

    /// <summary>Contiguous comment(s) directly above the node (no blank-line gap), or null.</summary>
    public static string? LeadingDocComment(Node? node, CommentStyle style)
    {
        if (node is null) return null;
        var comments = new List<Node>();
        var current = node;
        var sibling = node.PreviousSibling;
        while (sibling is not null && sibling.Type == style.LineCommentType)
        {
            if (sibling.EndPosition.Row + style.LineOffset != current.StartPosition.Row) break;
            comments.Insert(0, sibling);
            current = sibling;
            sibling = sibling.PreviousSibling;
        }
        if (comments.Count == 0) return null;
        var firstText = comments[0].Text;
        if (style.BlockPrefix is not null && firstText.StartsWith(style.BlockPrefix, StringComparison.Ordinal))
            return StripBlockComment(firstText, style);
        var lines = comments.Select(c =>
        {
            var t = c.Text;
            if (t.StartsWith(style.LinePrefix, StringComparison.Ordinal)) t = t[style.LinePrefix.Length..];
            return PyStrip(t);
        });
        return CleanDoc(string.Join('\n', lines));
    }

    // ---- symbol factories -----------------------------------------------------------------

    public static Symbol ModuleSymbol(Node root, string filePath, string language, string dotted,
        IReadOnlyDictionary<string, string> imports, string? docstring = null) => new()
    {
        Id = $"{filePath}::module::{dotted}",
        FilePath = filePath,
        Kind = SymbolKind.Module,
        Name = dotted.Length > 0 ? dotted[(dotted.LastIndexOf('.') + 1)..] : filePath,
        QualifiedName = dotted,
        StartLine = root.StartLine(),
        EndLine = root.EndLine(),
        Language = language,
        Imports = imports,
        Docstring = docstring,
    };

    public static Symbol ClassSymbol(Node node, string filePath, string language, string? enclosing, string parentId,
        List<string> calls, string? docstring = null, bool isExported = false, List<QualifiedReference>? qualifiedCalls = null)
    {
        var name = node.Field("name")?.Text ?? "<anonymous>";
        var qualname = !string.IsNullOrEmpty(enclosing) ? $"{enclosing}.{name}" : name;
        return new Symbol
        {
            Id = $"{filePath}::class::{qualname}",
            FilePath = filePath,
            Kind = SymbolKind.Class,
            Name = name,
            QualifiedName = qualname,
            StartLine = node.StartLine(),
            EndLine = node.EndLine(),
            Language = language,
            ParentSymbolId = parentId,
            References = calls,
            QualifiedReferences = qualifiedCalls ?? [],
            Docstring = docstring,
            IsExported = isExported,
        };
    }

    public static Symbol FunctionSymbol(Node span, string filePath, string language, string name, string qualname,
        string parentId, List<string> references, List<BodyStatement> statements, List<string>? assignedIdentifiers = null,
        string? docstring = null, bool isExported = false, List<QualifiedReference>? qualifiedReferences = null) => new()
    {
        Id = $"{filePath}::function::{qualname}",
        FilePath = filePath,
        Kind = SymbolKind.Function,
        Name = name,
        QualifiedName = qualname,
        StartLine = span.StartLine(),
        EndLine = span.EndLine(),
        Language = language,
        ParentSymbolId = parentId,
        References = references,
        QualifiedReferences = qualifiedReferences ?? [],
        AssignedIdentifiers = assignedIdentifiers ?? [],
        BodyStatements = statements,
        Docstring = docstring,
        IsExported = isExported,
    };
}
