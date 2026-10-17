using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CodeChroma.Bridge.Epics;

/// <summary>Adapts specs/&lt;slug&gt;/{spec,plan,tasks,...}.md to the delivery port: attach by epic frontmatter or Input-line ids.</summary>
public sealed partial class SpeckitDeliverySource(string itemsRoot, string repoRoot) : IDeliverySource
{
    [GeneratedRegex(@"(?:EP-)?[A-Z]+-\d+(?:-\d+)?")] private static partial Regex IdRegex();
    [GeneratedRegex(@"^\*\*Status\*\*:?\s*(.+)$", RegexOptions.Multiline)] private static partial Regex StatusRegex();
    [GeneratedRegex(@"^##\s+(.+?)\s*$", RegexOptions.Multiline)] private static partial Regex HeadingRegex();
    [GeneratedRegex(@"^([A-Z]+\d+)\b\s*(.*)$")] private static partial Regex ItemIdRegex();
    [GeneratedRegex(@"^\|(.+)\|\s*$")] private static partial Regex TableRowRegex();
    [GeneratedRegex(@"^:?-+:?$")] private static partial Regex TableSepCellRegex();
    [GeneratedRegex(@"^\*\*([^*]+)\*\*:?\s*(.*)$")] private static partial Regex BoldLeadinRegex();
    [GeneratedRegex(@"\[P\]")] private static partial Regex ParallelRegex();
    [GeneratedRegex(@"\[(US\d+)\]")] private static partial Regex StoryRegex();
    [GeneratedRegex(@"^\*\*Input\*\*")] private static partial Regex InputStartRegex();

    private static readonly (string Kind, string File)[] StageFiles =
        [("spec", "spec.md"), ("plan", "plan.md"), ("tasks", "tasks.md"), ("research", "research.md"), ("data-model", "data-model.md"), ("quickstart", "quickstart.md")];

    private static readonly (string Kind, string Dir)[] StageDirs = [("contract", "contracts"), ("checklist", "checklists")];

    public static string StageNodeId(string featureName, string kind) => $"epic-stage::{featureName}::{kind}";

    private static bool IsChecklistKind(string kind) => kind == "tasks" || kind.StartsWith("checklist-", StringComparison.Ordinal);

    private static string? Read(string path)
    {
        try
        {
            return PyText.ReadText(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or DecoderFallbackException)
        {
            return null;
        }
    }

    private static string? InputBlock(string text)
    {
        var lines = PyText.SplitLines(text);
        var start = lines.FindIndex(l => InputStartRegex().IsMatch(l.Trim()));
        if (start < 0) return null;
        var block = new List<string> { lines[start] };
        foreach (var line in lines.Skip(start + 1))
        {
            var stripped = line.Trim();
            if (stripped.Length == 0 || stripped.StartsWith('#') || BoldLeadinRegex().IsMatch(stripped)) break;
            block.Add(line);
        }
        return string.Join("\n", block);
    }

    private static string? StatusOf(string text) => StatusRegex().Match(text) is { Success: true } m ? m.Groups[1].Value.Trim() : null;

    private static (int Done, int Total) ChecklistCounts(string text)
    {
        int done = 0, total = 0;
        foreach (var line in PyText.SplitLines(text))
        {
            var match = Frontmatter.Checklist().Match(line.Trim());
            if (!match.Success) continue;
            total++;
            if (match.Groups[1].Value.Trim().ToLowerInvariant() == "x") done++;
        }
        return (done, total);
    }

    private static (bool Parallel, string? Story) MarkerFlags(string text) =>
        (ParallelRegex().IsMatch(text), StoryRegex().Match(text) is { Success: true } m ? m.Groups[1].Value : null);

    private static string FallbackId(int sectionIndex, int ordinal) => $"item-{sectionIndex}-{ordinal}";

    private static string ItemId(string raw, int sectionIndex, int ordinal) =>
        ItemIdRegex().Match(raw) is { Success: true } m ? m.Groups[1].Value : FallbackId(sectionIndex, ordinal);

    private static List<StageItem> ChecklistItems(string section, int sectionIndex)
    {
        var items = new List<StageItem>();
        bool? pendingDone = null;
        var pending = new List<string>();
        void Flush()
        {
            if (pending.Count == 0) return;
            var text = string.Join(" ", pending);
            var (parallel, story) = MarkerFlags(text);
            items.Add(new StageItem(ItemId(text, sectionIndex, items.Count + 1), text, pendingDone, story, parallel));
            pendingDone = null;
            pending = [];
        }
        foreach (var line in PyText.SplitLines(section))
        {
            var stripped = line.Trim();
            var checklist = Frontmatter.Checklist().Match(stripped);
            if (!checklist.Success)
            {
                var isFence = stripped.StartsWith('#') || stripped.StartsWith("```", StringComparison.Ordinal);
                if (pending.Count > 0 && stripped.Length > 0 && !isFence) pending.Add(stripped);
                else if (pending.Count > 0) Flush();
                continue;
            }
            Flush();
            pendingDone = checklist.Groups[1].Value.Trim().ToLowerInvariant() == "x";
            pending = [checklist.Groups[2].Value.Trim()];
        }
        Flush();
        return items;
    }

    private static List<StageItem> TableItems(string section, int sectionIndex)
    {
        var rows = new List<List<string>>();
        foreach (var line in PyText.SplitLines(section))
        {
            var match = TableRowRegex().Match(line.Trim());
            if (!match.Success) continue;
            var cells = match.Groups[1].Value.Split('|').Select(c => c.Trim()).ToList();
            if (cells.All(c => TableSepCellRegex().IsMatch(c))) continue;
            rows.Add(cells);
        }
        if (rows.Count < 2) return [];
        var items = new List<StageItem>();
        foreach (var cells in rows.Skip(1))
        {
            if (cells.Count == 0 || cells[0].Length == 0) continue;
            var rawId = cells[0].Trim('`', '*', ' ');
            var text = cells.Count > 1 ? string.Join(" — ", cells.Where(c => c.Length > 0)) : cells[0];
            var itemId = rawId.Length > 0 && !rawId.Contains(' ') ? rawId : FallbackId(sectionIndex, items.Count + 1);
            var (parallel, story) = MarkerFlags(text);
            items.Add(new StageItem(itemId, text, null, story, parallel));
        }
        return items;
    }

    private static StageItem Build(string itemId, string text)
    {
        var (parallel, story) = MarkerFlags(text);
        return new StageItem(itemId, text, null, story, parallel);
    }

    private static List<StageItem> BulletItems(string section, int sectionIndex)
    {
        var items = new List<StageItem>();
        string? pendingId = null;
        var pending = new List<string>();
        void Flush()
        {
            if (pendingId is null) return;
            items.Add(Build(pendingId, string.Join(" ", pending)));
            pendingId = null;
            pending = [];
        }
        foreach (var line in PyText.SplitLines(section))
        {
            var stripped = line.Trim();
            var bullet = Frontmatter.Bullet().Match(stripped);
            string? raw = bullet.Success ? bullet.Groups[1].Value.Trim() : null;
            if (raw is null && BoldLeadinRegex().IsMatch(stripped)) raw = stripped;
            if (raw is not null)
            {
                Flush();
                var leadIn = BoldLeadinRegex().Match(raw);
                if (bullet.Success)
                {
                    var (id, text) = leadIn.Success ? (leadIn.Groups[1].Value.Trim(), raw) : (ItemId(raw, sectionIndex, items.Count + 1), raw);
                    items.Add(Build(id, text));
                }
                else
                {
                    pendingId = leadIn.Groups[1].Value.Trim();
                    pending = [raw];
                }
                continue;
            }
            if (pendingId is null) continue;
            if (stripped.Length == 0 || stripped.StartsWith('#') || stripped.StartsWith("```", StringComparison.Ordinal)) Flush();
            else pending.Add(stripped);
        }
        Flush();
        return items;
    }

    private static (int? Done, int? Total) SectionCounts(IReadOnlyList<StageItem> items) =>
        items.Count == 0 || items[0].Done is null ? (null, null) : (items.Count(i => i.Done == true), items.Count);

    private static List<StageSection> ParseSections(string text)
    {
        var headings = HeadingRegex().Matches(text).ToList();
        var sections = new List<StageSection>();
        for (var index = 0; index < headings.Count; index++)
        {
            var match = headings[index];
            var start = match.Index + match.Length;
            var end = index + 1 < headings.Count ? headings[index + 1].Index : text.Length;
            var body = text[start..end];
            var items = new List<StageItem>();
            foreach (var extractor in new Func<string, int, List<StageItem>>[] { ChecklistItems, TableItems, BulletItems })
            {
                items = extractor(body, index);
                if (items.Count > 0) break;
            }
            if (items.Count == 0) continue;
            var (done, total) = SectionCounts(items);
            sections.Add(new StageSection(match.Groups[1].Value.Trim(), items, done, total));
        }
        return sections;
    }

    private static List<string> FeatureDirs(string root) =>
        Directory.Exists(root) ? [.. Directory.GetDirectories(root).OrderBy(Path.GetFileName, StringComparer.Ordinal)] : [];

    private HashSet<string> AttachedIds(string featureDir)
    {
        var frontmatter = Frontmatter.ReadOnly(Path.Combine(featureDir, "spec.md"));
        if (frontmatter is not null)
        {
            if (Stores.Json.Str(frontmatter["epic"]) is { } epic) return [epic];
            if (frontmatter["epics"] is JsonArray epics) return [.. epics.Select(e => e?.ToString() ?? "")];
        }
        var ids = new HashSet<string>();
        foreach (var file in new[] { "spec.md", "plan.md" })
        {
            if (Read(Path.Combine(featureDir, file)) is not { } text || InputBlock(text) is not { Length: > 0 } block) continue;
            foreach (Match match in IdRegex().Matches(block)) ids.Add(match.Value);
        }
        return ids;
    }

    private Stage StageFor(string featureDir, string kind, string path, string? expand)
    {
        var name = Path.GetFileName(featureDir);
        var nodeId = StageNodeId(name, kind);
        var text = Read(path) ?? "";
        int? done = null, total = null;
        string? status = null;
        if (IsChecklistKind(kind)) (done, total) = ChecklistCounts(text);
        else status = StatusOf(text);
        var sections = expand == nodeId ? ParseSections(text) : [];
        return new Stage(kind, name, Frontmatter.RelativeSourceRef(path, repoRoot), status, done, total, sections);
    }

    private static List<(string Kind, string Path)> ArtifactPaths(string featureDir)
    {
        var artifacts = new List<(string, string)>();
        foreach (var (kind, file) in StageFiles)
            if (File.Exists(Path.Combine(featureDir, file))) artifacts.Add((kind, Path.Combine(featureDir, file)));
        foreach (var (prefix, dir) in StageDirs)
        {
            var directory = Path.Combine(featureDir, dir);
            if (!Directory.Exists(directory)) continue;
            foreach (var file in Directory.GetFiles(directory, "*.md").OrderBy(Path.GetFileName, StringComparer.Ordinal))
                artifacts.Add(($"{prefix}-{Path.GetFileNameWithoutExtension(file)}", file));
        }
        return artifacts;
    }

    public IReadOnlyList<Stage> StagesFor(string itemId, string? expand = null)
    {
        var stages = new List<Stage>();
        foreach (var featureDir in FeatureDirs(itemsRoot))
        {
            if (!AttachedIds(featureDir).Contains(itemId)) continue;
            foreach (var (kind, path) in ArtifactPaths(featureDir)) stages.Add(StageFor(featureDir, kind, path, expand));
        }
        return stages;
    }
}
