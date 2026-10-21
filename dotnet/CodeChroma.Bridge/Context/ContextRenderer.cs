using System.Text;

namespace CodeChroma.Bridge.Context;

/// <summary>Prints the selected components as the compact text the bare agent reads instead of the source.</summary>
public static class ContextRenderer
{
    private const string Hint =
        "node_id = `<path>::function::<name>` or `<path>::class::<name>`. A line `<node_id> Lx-y > a > b` is a function: its full node_id (copy it verbatim), " +
        "source lines, and the repo functions and Error<code> it calls in code order (conditions not shown). `also:` lists other symbols of the file with no calls: " +
        "build their node_id from the file path above them.";

    /// <summary>Soft output cap: when the full-size rendering is larger, every tier's files and symbols shrink one step.</summary>
    public const int TargetChars = 30_000;

    private readonly record struct Budget(int Files, int Symbols);

    /// <summary>Per shrink step: budgets for the top 3, the next 4 and the last matches (the best matches get the most detail).</summary>
    private static readonly (Budget Top, Budget Mid, Budget Low)[] Steps =
    [
        (new(8, 8), new(5, 6), new(3, 4)),
        (new(7, 7), new(4, 5), new(3, 3)),
        (new(6, 6), new(4, 4), new(2, 3)),
        (new(5, 5), new(3, 4), new(2, 2)),
        (new(4, 5), new(3, 3), new(2, 2)),
        (new(4, 4), new(2, 3), new(1, 2)),
        (new(3, 4), new(2, 2), new(1, 2)),
        (new(3, 3), new(1, 2), new(1, 1)),
    ];

    public static string Render(ContextData data, Selection selection, IReadOnlyList<string> phrases)
    {
        var text = "";
        var words = QueryWords(phrases);
        foreach (var step in Steps)
        {
            text = Render(data, selection, phrases, words, step);
            if (text.Length <= TargetChars) break;
        }
        return text;
    }

    private static string Render(ContextData data, Selection selection, IReadOnlyList<string> phrases, IReadOnlyList<string> words, (Budget Top, Budget Mid, Budget Low) step)
    {
        var text = new StringBuilder();
        text.Append("# Context for: ").AppendLine(string.Join(", ", phrases)).AppendLine().AppendLine(Hint).AppendLine();
        Architecture(text, data, selection);
        text.Append("## Best matches (").Append(selection.Seeds.Count).AppendLine(")").AppendLine();
        for (var i = 0; i < selection.Seeds.Count; i++)
        {
            var budget = i < 3 ? step.Top : i < 7 ? step.Mid : step.Low;
            Page(text, selection.Seeds[i], budget.Files, budget.Symbols, withCalls: true, words);
        }
        if (selection.Neighbours.Count > 0)
        {
            text.Append("## Related via imports (").Append(selection.Neighbours.Count).AppendLine(")").AppendLine();
            foreach (var page in selection.Neighbours) Page(text, page, Math.Min(step.Low.Files, ContextLimits.MaxFilesNeighbour), Math.Min(step.Low.Symbols, ContextLimits.MaxSymbolsNeighbour), withCalls: false, words);
        }
        Links(text, data, selection);
        return text.ToString();
    }

    private static void Architecture(StringBuilder text, ContextData data, Selection selection)
    {
        var selected = selection.Seeds.Concat(selection.Neighbours).ToList();
        var shown = selected.Select(p => p.Container).ToHashSet();
        text.AppendLine("## Architecture (containers; the components below are listed under the one they belong to)").AppendLine();
        foreach (var container in data.Containers.Where(c => shown.Contains(c.Id)))
        {
            text.Append("- **").Append(container.Name.ToLowerInvariant()).Append("** — ").AppendLine(container.Purpose);
            if (container.Description.Length > 0) text.Append("  ").AppendLine(Cut(container.Description, ContextLimits.MaxArchBody));
            var listed = selected.Where(p => p.Container == container.Id).Select(p => p.Id).ToHashSet();
            var unlisted = data.Pages.Where(p => p.Container == container.Id && !listed.Contains(p.Id)).Select(p => p.Id).ToList();
            text.Append("  listed below: ").AppendLine(string.Join(", ", listed));
            if (unlisted.Count > 0)
                text.Append("  not listed (").Append(unlisted.Count).Append("): ").Append(string.Join(", ", unlisted.Take(ContextLimits.MaxUnlistedNames))).AppendLine(unlisted.Count > ContextLimits.MaxUnlistedNames ? " …" : "");
        }
        var containerOf = data.Pages.ToDictionary(p => p.Id, p => p.Container);
        var cross = data.Edges.Where(e => containerOf.TryGetValue(e.From, out var a) && containerOf.TryGetValue(e.To, out var b) && a != b && shown.Contains(a) && shown.Contains(b))
            .GroupBy(e => (containerOf[e.From], containerOf[e.To])).Select(g => $"{g.Key.Item1}>{g.Key.Item2} {g.Sum(e => e.Count)}").ToList();
        if (cross.Count > 0) text.AppendLine().Append("container links: ").AppendLine(string.Join(", ", cross));
        text.AppendLine();
    }

    private static void Page(StringBuilder text, PageInfo page, int maxFiles, int maxSymbols, bool withCalls, IReadOnlyList<string> words)
    {
        text.Append("### ").Append(page.Id).Append(" — ").AppendLine(page.Title);
        if (withCalls && page.Description.Length > 0) text.AppendLine(Cut(page.Description, ContextLimits.MaxBody));
        var ordered = OrderFiles(page.Files, words).ToList();
        foreach (var file in ordered.Take(maxFiles))
        {
            text.Append('`').Append(file.Path).AppendLine("`");
            var symbols = file.Symbols.Select((sym, index) => (sym, index)).OrderByDescending(x => Hits(words, x.sym.Name)).ThenByDescending(x => x.sym.Calls.Count).ThenBy(x => x.index).Take(maxSymbols).OrderBy(x => x.index).Select(x => x.sym).ToList();
            if (withCalls)
            {
                foreach (var s in symbols.Where(s => s.Calls.Count > 0))
                    text.Append("  ").Append(s.NodeId).Append(" L").Append(s.Start).Append('-').Append(s.End).Append(" > ").AppendLine(string.Join(" > ", s.Calls));
                var plain = symbols.Where(s => s.Calls.Count == 0).Select(s => s.IsClass ? $"{s.Name} (class)" : s.Name).ToList();
                var rest = file.Symbols.Count - symbols.Count;
                if (plain.Count > 0 || rest > 0) text.Append("  also: ").Append(string.Join(", ", plain)).AppendLine(rest > 0 ? $" (+{rest} more)" : "");
            }
            else if (symbols.Count > 0) text.Append("  ").AppendLine(string.Join(", ", symbols.Select(s => s.Name)));
        }
        var hidden = ordered.Skip(maxFiles).Select(f => f.Path).Concat(page.OtherFiles).ToList();
        if (hidden.Count > 0) text.Append("(+").Append(hidden.Count).Append(" more files: ").Append(string.Join(", ", hidden.Take(8).Select(Path.GetFileName))).AppendLine(hidden.Count > 8 ? ", …)" : ")");
        text.AppendLine();
    }

    /// <summary>Lower-cased phrase words of 4+ letters, with a trailing plural s dropped, used to float matching files and symbols up.</summary>
    private static List<string> QueryWords(IReadOnlyList<string> phrases) =>
        [.. phrases.SelectMany(p => p.ToLowerInvariant().Split([' ', '/', '-', '_', '.'], StringSplitOptions.RemoveEmptyEntries))
            .Where(w => w.Length >= 4).Select(w => w.EndsWith('s') && w.Length > 4 ? w[..^1] : w).Distinct()];

    private static int Hits(IReadOnlyList<string> words, string text)
    {
        var lower = text.ToLowerInvariant();
        return words.Count(lower.Contains);
    }

    /// <summary>Files whose path or symbol names mention the query first; the builder's order (most call-bearing) breaks ties.</summary>
    private static IEnumerable<FileEntry> OrderFiles(IReadOnlyList<FileEntry> files, IReadOnlyList<string> words) =>
        files.Select((file, index) => (file, index)).OrderByDescending(x => Hits(words, x.file.Path + " " + string.Join(' ', x.file.Symbols.Select(s => s.Name)))).ThenBy(x => x.index).Select(x => x.file);

    private static void Links(StringBuilder text, ContextData data, Selection selection)
    {
        var ids = selection.Seeds.Concat(selection.Neighbours).Select(p => p.Id).ToHashSet();
        var links = data.Edges.Where(e => e.Count >= ContextLimits.MinEdgeWeight && ids.Contains(e.From) && ids.Contains(e.To)).Select(e => $"{e.From}>{e.To} {e.Count}").ToList();
        if (links.Count > 0) text.AppendLine("## Links").AppendLine().AppendLine(string.Join(", ", links));
    }

    private static string Cut(string value, int max) => value.Length <= max ? value : value[..max].TrimEnd() + " …";
}
