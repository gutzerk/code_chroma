using System.Text.RegularExpressions;

namespace CodeChroma.Bridge.Skills;

/// <summary>Deterministic component/container id and name assignment; the code's job, never the model's (wiki_general_naming.py).</summary>
public static partial class WikiGeneralNaming
{
    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonSlug();

    public static string Slugify(string text)
    {
        var slug = NonSlug().Replace(text.ToLowerInvariant(), "-").Trim('-');
        return slug.Length == 0 ? "group" : slug;
    }

    /// <summary>The candidate, or candidate-2, candidate-3, ... the first one not already taken.</summary>
    public static string DedupeId(string candidate, ISet<string> taken)
    {
        if (!taken.Contains(candidate)) return candidate;
        var n = 2;
        while (taken.Contains($"{candidate}-{n}")) n++;
        return $"{candidate}-{n}";
    }

    /// <summary>The display name with the dedupe counter appended, so two same-named groups stay distinct.</summary>
    public static string UniqueDisplay(string display, string baseId, string realId) =>
        realId == baseId || !realId.StartsWith($"{baseId}-", StringComparison.Ordinal) ? display : $"{display} {realId[(baseId.Length + 1)..]}";

    /// <summary>Python's str.title(): a letter is upper-cased when the one before it is not a letter, else lower-cased.</summary>
    private static string Title(string text)
    {
        var chars = text.ToCharArray();
        var previousIsLetter = false;
        for (var i = 0; i < chars.Length; i++)
        {
            var isLetter = char.IsLetter(chars[i]);
            if (isLetter) chars[i] = previousIsLetter ? char.ToLowerInvariant(chars[i]) : char.ToUpperInvariant(chars[i]);
            previousIsLetter = isLetter;
        }
        return new string(chars);
    }

    private static string Stem(string name)
    {
        var dot = name.LastIndexOf('.');
        return dot > 0 && dot < name.Length - 1 ? name[..dot] : name;
    }

    private static string FirstSegment(string file) => file.Split('/', StringSplitOptions.RemoveEmptyEntries) is { Length: > 0 } parts ? parts[0] : file;

    private static string ParentName(string file)
    {
        var segments = file.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length >= 2) return segments[^2];
        return Stem(segments.Length == 1 ? segments[0] : file);
    }

    /// <summary>The kebab-case id and display name from the group's heaviest folder or file.</summary>
    public static (string Id, string Display) DeterministicName(IReadOnlyList<string> files, bool topLevel)
    {
        var counts = new List<KeyValuePair<string, int>>();
        foreach (var file in files)
        {
            var key = topLevel ? FirstSegment(file) : ParentName(file);
            var index = counts.FindIndex(kv => kv.Key == key);
            if (index < 0) counts.Add(new(key, 1));
            else counts[index] = new(key, counts[index].Value + 1);
        }
        // Counter.most_common(1): the highest count, the first-seen key among ties.
        var winner = counts.Count == 0 ? "component" : counts.Aggregate((best, next) => next.Value > best.Value ? next : best).Key;
        var display = Title(winner.Replace('_', ' ').Replace('-', ' ').Trim());
        return (Slugify(winner), display.Length == 0 ? "Component" : display);
    }

    /// <summary>internal id to (real id, display name) for every group, deduped against each other, in group order.</summary>
    public static List<(string InternalId, string RealId, string Name)> AssignIds(IEnumerable<(string InternalId, IReadOnlyList<string> Files)> groups, bool topLevel)
    {
        var used = new HashSet<string>();
        var resolved = new List<(string, string, string)>();
        foreach (var (internalId, files) in groups)
        {
            var (baseId, display) = DeterministicName(files, topLevel);
            var id = DedupeId(baseId, used);
            used.Add(id);
            resolved.Add((internalId, id, UniqueDisplay(display, baseId, id)));
        }
        return resolved;
    }
}
