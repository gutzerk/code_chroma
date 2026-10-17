using YamlDotNet.Core;
using YamlDotNet.Core.Events;

namespace CodeChroma.Core.Analyzers;

/// <summary>YAML analyzer: GitHub Actions get dialect names, else a generic parse; mirrors analyzers/yaml_analyzer.py.</summary>
public sealed class YamlAnalyzer : ILanguageAnalyzer
{
    private static readonly string[] ActionFilenames = ["action.yml", "action.yaml"];

    public string Language => "yaml";

    public IReadOnlyList<string> Extensions { get; } = [".yml", ".yaml"];

    public string? ResolveImport(string importText, string importerFile, string repoRoot) => null;

    // ---- pyyaml-shaped composed nodes (lines are 1-based) -----------------------------------

    private abstract class YNode(int startLine, int endLine)
    {
        public int StartLine { get; } = startLine;
        public int EndLine { get; } = endLine;
    }

    private sealed class YScalar(string value, int startLine, int endLine) : YNode(startLine, endLine)
    {
        public string Value { get; } = value;
    }

    private sealed class YSequence(List<YNode> items, int startLine, int endLine) : YNode(startLine, endLine)
    {
        public List<YNode> Items { get; } = items;
    }

    private sealed class YMapping(List<(YNode Key, YNode Value)> entries, int startLine, int endLine) : YNode(startLine, endLine)
    {
        public List<(YNode Key, YNode Value)> Entries { get; } = entries;
    }

    /// <summary>Composes every document the way pyyaml's compose_all does (duplicate keys and aliases kept).</summary>
    private static List<YNode> ComposeAll(string text)
    {
        var parser = new Parser(new StringReader(text));
        var documents = new List<YNode>();
        parser.Consume<StreamStart>();
        while (parser.Accept<DocumentStart>(out _))
        {
            parser.Consume<DocumentStart>();
            var anchors = new Dictionary<string, YNode>();
            documents.Add(ComposeNode(parser, anchors));
            parser.Consume<DocumentEnd>();
        }
        return documents;
    }

    private static YNode ComposeNode(IParser parser, Dictionary<string, YNode> anchors)
    {
        switch (parser.Current)
        {
            case AnchorAlias alias:
                parser.MoveNext();
                return anchors.TryGetValue(alias.Value.Value, out var target)
                    ? target
                    : throw new YamlException(alias.Start, alias.End, "found undefined alias");
            case Scalar scalar:
            {
                parser.MoveNext();
                var node = new YScalar(scalar.Value, (int)scalar.Start.Line, (int)scalar.End.Line);
                Register(anchors, scalar.Anchor, node);
                return node;
            }
            case SequenceStart seq:
            {
                parser.MoveNext();
                var items = new List<YNode>();
                while (parser.Current is not SequenceEnd) items.Add(ComposeNode(parser, anchors));
                var node = new YSequence(items, (int)seq.Start.Line, (int)parser.Current!.End.Line);
                parser.MoveNext();
                Register(anchors, seq.Anchor, node);
                return node;
            }
            case MappingStart map:
            {
                parser.MoveNext();
                var entries = new List<(YNode, YNode)>();
                while (parser.Current is not MappingEnd)
                {
                    var key = ComposeNode(parser, anchors);
                    entries.Add((key, ComposeNode(parser, anchors)));
                }
                var node = new YMapping(entries, (int)map.Start.Line, (int)parser.Current!.End.Line);
                parser.MoveNext();
                Register(anchors, map.Anchor, node);
                return node;
            }
            default:
                throw new YamlException($"unexpected yaml event {parser.Current?.GetType().Name}");
        }
    }

    private static void Register(Dictionary<string, YNode> anchors, AnchorName anchor, YNode node)
    {
        if (!anchor.IsEmpty) anchors[anchor.Value] = node;
    }

    // ---- helpers ---------------------------------------------------------------------------

    private static string? ScalarText(YNode? node)
    {
        if (node is not YScalar scalar) return null;
        var text = Syntax.PyStrip(scalar.Value);
        return text.Length > 0 ? text : null;
    }

    private static List<(string Key, YNode KeyNode, YNode Value)> NamedEntries(YNode? node) =>
        node is YMapping map
            ? map.Entries.Where(e => e.Key is YScalar).Select(e => (((YScalar)e.Key).Value, e.Key, e.Value)).ToList()
            : [];

    private static YNode? FieldOf(YNode? node, string name)
    {
        YNode? found = null;
        foreach (var (key, _, value) in NamedEntries(node))
            if (key == name) found = value;
        return found;
    }

    private static bool IsListOfMappings(YNode? node) =>
        node is YSequence seq && seq.Items.Count > 0 && seq.Items.All(i => i is YMapping);

    private static (int Start, int End) Span(YNode start, YNode? end = null) => (start.StartLine, (end ?? start).EndLine);

    private static Symbol ModuleSymbol(string filePath, YNode? root, string source)
    {
        var dotted = Syntax.ModuleDottedPath(filePath);
        var (start, end) = root is not null ? Span(root) : (1, Math.Max(1, source.Count(c => c == '\n') + 1));
        return new Symbol
        {
            Id = $"{filePath}::module::{dotted}", FilePath = filePath, Kind = SymbolKind.Module,
            Name = dotted.Length > 0 ? dotted[(dotted.LastIndexOf('.') + 1)..] : filePath,
            QualifiedName = dotted, StartLine = start, EndLine = end, Language = "yaml",
        };
    }

    private static Symbol ClassSymbol(string filePath, string qualname, string name, (int Start, int End) span, string parentId, string? docstring = null) => new()
    {
        Id = $"{filePath}::class::{qualname}", FilePath = filePath, Kind = SymbolKind.Class, Name = name,
        QualifiedName = qualname, StartLine = span.Start, EndLine = span.End, Language = "yaml",
        ParentSymbolId = parentId, Docstring = docstring,
    };

    private static Symbol FunctionSymbol(string filePath, string qualname, string name, (int Start, int End) span, string parentId) => new()
    {
        Id = $"{filePath}::function::{qualname}", FilePath = filePath, Kind = SymbolKind.Function, Name = name,
        QualifiedName = qualname, StartLine = span.Start, EndLine = span.End, Language = "yaml", ParentSymbolId = parentId,
    };

    private static string StepName(YMapping step, int index)
    {
        var name = ScalarText(FieldOf(step, "name"));
        if (name is not null) return name;
        var uses = ScalarText(FieldOf(step, "uses"));
        if (uses is not null) return uses;
        if (FieldOf(step, "run") is YScalar run)
        {
            var first = Syntax.SplitLines(run.Value).Select(Syntax.PyStrip).FirstOrDefault(l => l.Length > 0);
            if (!string.IsNullOrEmpty(first)) return first;
        }
        return $"Step {index}";
    }

    private static string ItemName(YMapping item, int index) =>
        ScalarText(FieldOf(item, "name")) ?? ScalarText(FieldOf(item, "id")) ?? $"item {index}";

    private static List<Symbol> MappingSequenceSymbols(string filePath, YSequence seq, string parentQualname, string parentId,
        string label, Func<YMapping, int, string> nameOf)
    {
        var symbols = new List<Symbol>();
        var index = 0;
        foreach (var item in seq.Items)
        {
            index++;
            if (item is not YMapping mapping) continue;
            symbols.Add(FunctionSymbol(filePath, $"{parentQualname}.{label}_{index}", nameOf(mapping, index), Span(item), parentId));
        }
        return symbols;
    }

    private static List<Symbol> ParseWorkflow(string filePath, YMapping jobs, string moduleId, string prefix)
    {
        var symbols = new List<Symbol>();
        foreach (var (jobId, jobKey, jobValue) in NamedEntries(jobs))
        {
            if (jobValue is not YMapping) continue;
            var qualname = $"{prefix}{jobId}";
            var display = ScalarText(FieldOf(jobValue, "name")) ?? jobId;
            var cls = ClassSymbol(filePath, qualname, display, Span(jobKey, jobValue), moduleId);
            symbols.Add(cls);
            if (FieldOf(jobValue, "steps") is YSequence steps)
                symbols.AddRange(MappingSequenceSymbols(filePath, steps, qualname, cls.Id, "step", StepName));
        }
        return symbols;
    }

    private static List<Symbol> ParseAction(string filePath, YMapping root, string moduleId, string prefix)
    {
        var parentName = filePath.Replace('\\', '/').Split('/') is { Length: > 1 } parts ? parts[^2] : "";
        var display = ScalarText(FieldOf(root, "name")) ?? parentName;
        var qualname = $"{prefix}{display}";
        var cls = ClassSymbol(filePath, qualname, display, Span(root), moduleId, ScalarText(FieldOf(root, "description")));
        var symbols = new List<Symbol> { cls };
        var runs = FieldOf(root, "runs");
        if (ScalarText(FieldOf(runs, "using")) == "composite" && FieldOf(runs, "steps") is YSequence steps)
            symbols.AddRange(MappingSequenceSymbols(filePath, steps, qualname, cls.Id, "step", StepName));
        return symbols;
    }

    private static List<Symbol> ParseGeneric(string filePath, YNode root, string moduleId, string prefix)
    {
        var symbols = new List<Symbol>();
        foreach (var (key, keyNode, value) in NamedEntries(root))
        {
            var listOfMappings = IsListOfMappings(value);
            if (!(value is YMapping || listOfMappings)) continue;
            var qualname = $"{prefix}{key}";
            var cls = ClassSymbol(filePath, qualname, key, Span(keyNode, value), moduleId);
            symbols.Add(cls);
            if (listOfMappings && value is YSequence seq)
                symbols.AddRange(MappingSequenceSymbols(filePath, seq, qualname, cls.Id, "item", ItemName));
        }
        return symbols;
    }

    public IReadOnlyList<Symbol> Parse(string filePath, string source)
    {
        var text = source.Length > 0 && source[0] == '﻿' ? source[1..] : source;
        var documents = ComposeAll(text);
        var module = ModuleSymbol(filePath, documents.Count == 1 ? documents[0] : null, source);
        var symbols = new List<Symbol> { module };
        var fileName = filePath.Replace('\\', '/').Split('/')[^1];
        for (var i = 0; i < documents.Count; i++)
        {
            var root = documents[i];
            var prefix = documents.Count > 1 ? $"doc{i + 1}." : "";
            if (FieldOf(root, "jobs") is YMapping jobs) symbols.AddRange(ParseWorkflow(filePath, jobs, module.Id, prefix));
            else if (root is YMapping rootMap && ActionFilenames.Contains(fileName) && FieldOf(rootMap, "runs") is not null)
                symbols.AddRange(ParseAction(filePath, rootMap, module.Id, prefix));
            else symbols.AddRange(ParseGeneric(filePath, root, module.Id, prefix));
        }
        return symbols;
    }
}
