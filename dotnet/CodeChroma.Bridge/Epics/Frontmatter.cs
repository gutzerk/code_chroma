using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Stores;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace CodeChroma.Bridge.Epics;

/// <summary>Python-flavoured text helpers the markdown parsers rely on.</summary>
public static class PyText
{
    private static readonly char[] Breaks = [.. new int[] { 0x0A, 0x0D, 0x0B, 0x0C, 0x1C, 0x1D, 0x1E, 0x85, 0x2028, 0x2029 }.Select(c => (char)c)];

    /// <summary>str.splitlines: \r\n is one break and no empty trailing line is produced.</summary>
    public static List<string> SplitLines(string text)
    {
        var lines = new List<string>();
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (!Breaks.Contains(text[i])) continue;
            lines.Add(text[start..i]);
            if (text[i] == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
            start = i + 1;
        }
        if (start < text.Length) lines.Add(text[start..]);
        return lines;
    }

    /// <summary>Strict UTF-8 read with universal newlines, like Path.read_text; throws on bad bytes.</summary>
    public static string ReadText(string path) =>
        new UTF8Encoding(false, true).GetString(File.ReadAllBytes(path)).Replace("\r\n", "\n").Replace('\r', '\n');
}

/// <summary>Frontmatter YAML split, criteria-section locator and the three criteria body parsers.</summary>
public static partial class Frontmatter
{
    public static readonly HashSet<string> CriteriaSynonyms = ["acceptance criteria", "success criteria", "key deliverables"];

    [GeneratedRegex(@"^\d+[.)]?\s*")] private static partial Regex LeadingNumber();
    [GeneratedRegex(@"\s*[*_]{0,2}\([^)]*\)[*_]{0,2}\s*$")] private static partial Regex TrailingAnnotation();
    [GeneratedRegex(@"^(#{1,6})[ \t]+(.+?)[ \t]*$", RegexOptions.Multiline)] private static partial Regex Heading();
    [GeneratedRegex(@"^[-*]\s*\[([ xXoO]?)\]\s*(.+)$")] public static partial Regex Checklist();
    [GeneratedRegex(@"^\s*[—-]\s*(\S.*)$")] private static partial Regex Citation();
    [GeneratedRegex(@"^\*{0,2}given\b", RegexOptions.IgnoreCase)] private static partial Regex GwtStart();
    [GeneratedRegex(@"^\*{0,2}illustrative", RegexOptions.IgnoreCase)] private static partial Regex Illustrative();
    [GeneratedRegex(@"^(?:[-*]|\d+[.)])\s+(.+)$")] public static partial Regex Bullet();
    [GeneratedRegex(@"^[-+]?\d+$")] private static partial Regex IntScalar();
    [GeneratedRegex(@"^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$")] private static partial Regex FloatScalar();
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}([ Tt].*)?$")] private static partial Regex DateScalar();

    /// <summary>Splits a leading ---/--- YAML block from the body; malformed input yields ({}, text).</summary>
    public static (JsonObject Data, string Body) Split(string text)
    {
        if (!text.StartsWith("---", StringComparison.Ordinal)) return ([], text);
        var end = text.IndexOf("\n---", 3, StringComparison.Ordinal);
        if (end == -1) return ([], text);
        var head = text[3..end];
        var rest = text[(end + 4)..];
        var newline = rest.IndexOf('\n');
        var body = newline != -1 ? rest[(newline + 1)..] : "";
        return ParseYaml(head) is { } data ? (data, body) : ([], text);
    }

    /// <summary>Reads only the leading frontmatter block's bytes, so a bad body encoding cannot taint it.</summary>
    public static JsonObject? ReadOnly(string path)
    {
        byte[] raw;
        try
        {
            using var stream = new BufferedStream(File.OpenRead(path));
            var buffer = new List<byte>();
            if (!string.Equals(ReadLine(stream, buffer), "---", StringComparison.Ordinal)) return null;
            var head = new List<byte>();
            while (true)
            {
                var line = ReadLine(stream, buffer, head);
                if (line is null) return null;
                if (line == "---") break;
            }
            raw = [.. head];
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
        try
        {
            return ParseYaml(new UTF8Encoding(false, true).GetString(raw));
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }

    /// <summary>One line (without its terminator) as latin-1 text for comparison; also appends raw bytes to <paramref name="keep"/>.</summary>
    private static string? ReadLine(Stream stream, List<byte> scratch, List<byte>? keep = null)
    {
        scratch.Clear();
        int b;
        var any = false;
        while ((b = stream.ReadByte()) != -1)
        {
            any = true;
            scratch.Add((byte)b);
            if (b == '\n') break;
        }
        if (!any) return null;
        var line = Encoding.Latin1.GetString([.. scratch]).TrimEnd('\r', '\n');
        if (line != "---") keep?.AddRange(scratch);
        return line;
    }

    /// <summary>The mapping of a YAML document, or null for malformed YAML or a non-mapping root.</summary>
    public static JsonObject? ParseYaml(string yaml)
    {
        try
        {
            var stream = new YamlStream();
            stream.Load(new StringReader(yaml));
            return stream.Documents.Count > 0 && stream.Documents[0].RootNode is YamlMappingNode mapping ? (JsonObject?)ToJson(mapping) : stream.Documents.Count == 0 ? null : null;
        }
        catch (YamlException)
        {
            return null;
        }
    }

    private static JsonNode? ToJson(YamlNode node)
    {
        switch (node)
        {
            case YamlScalarNode scalar:
                return scalar.Style == ScalarStyle.Plain ? Plain(scalar.Value) : JsonValue.Create(scalar.Value ?? "");
            case YamlMappingNode mapping:
                var obj = new JsonObject();
                foreach (var (key, value) in mapping.Children)
                    if (key is YamlScalarNode k && k.Value is { } name) obj[name] = ToJson(value);
                return obj;
            case YamlSequenceNode sequence:
                return new JsonArray(sequence.Children.Select(ToJson).ToArray());
            default:
                return null;
        }
    }

    /// <summary>YAML 1.1 plain scalar typing (what PyYAML's safe_load does), so non-strings stay non-strings.</summary>
    private static JsonNode? Plain(string? value)
    {
        if (string.IsNullOrEmpty(value) || value is "~" or "null" or "Null" or "NULL") return null;
        if (value is "true" or "True" or "TRUE" or "yes" or "Yes" or "YES" or "on" or "On" or "ON") return JsonValue.Create(true);
        if (value is "false" or "False" or "FALSE" or "no" or "No" or "NO" or "off" or "Off" or "OFF") return JsonValue.Create(false);
        if (IntScalar().IsMatch(value) && long.TryParse(value, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var l)) return JsonValue.Create(l);
        if (FloatScalar().IsMatch(value) && double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) return JsonValue.Create(d);
        if (DateScalar().IsMatch(value)) return new JsonObject { ["$date"] = value };
        return JsonValue.Create(value);
    }

    /// <summary>Drops a leading ordinal and a trailing italic parenthetical, then casefolds.</summary>
    public static string NormalizeHeading(string raw)
    {
        var text = LeadingNumber().Replace(raw.Trim(), "", 1);
        text = TrailingAnnotation().Replace(text, "", 1);
        return text.TrimEnd(':').Trim().ToLowerInvariant();
    }

    /// <summary>Text between a heading whose normalized name is in the set and the next same or higher heading.</summary>
    public static string? FindSection(string body, HashSet<string>? names = null)
    {
        names ??= CriteriaSynonyms;
        var headings = Heading().Matches(body).ToList();
        for (var index = 0; index < headings.Count; index++)
        {
            var match = headings[index];
            if (!names.Contains(NormalizeHeading(match.Groups[2].Value))) continue;
            var level = match.Groups[1].Length;
            var start = match.Index + match.Length;
            var end = body.Length;
            foreach (var later in headings.Skip(index + 1))
                if (later.Groups[1].Length <= level) { end = later.Index; break; }
            return body[start..end].Trim();
        }
        return null;
    }

    private static (string Text, string SourceRef) SplitCitation(string text, string defaultRef)
    {
        var lines = PyText.SplitLines(text);
        if (lines.Count > 0 && Citation().Match(lines[^1]) is { Success: true } citation)
            return (string.Join("\n", lines.Take(lines.Count - 1)).Trim(), citation.Groups[1].Value.Trim());
        return (text, defaultRef);
    }

    private static List<Requirement> ParseChecklist(string section, string defaultRef)
    {
        var requirements = new List<Requirement>();
        var index = 0;
        foreach (var line in PyText.SplitLines(section))
        {
            index++;
            var match = Checklist().Match(line.Trim());
            if (!match.Success) continue;
            var (text, sourceRef) = SplitCitation(match.Groups[2].Value.Trim(), defaultRef);
            requirements.Add(new Requirement($"checklist-{index}", text, "checklist", sourceRef, match.Groups[1].Value.Trim().ToLowerInvariant() == "x"));
        }
        return requirements;
    }

    private static List<string> Blocks(string section) =>
        Regex.Split(section, @"\n\s*\n").Select(b => b.Trim()).Where(b => b.Length > 0).ToList();

    private static List<Requirement> ParseGivenWhenThen(string section, string defaultRef)
    {
        var requirements = new List<Requirement>();
        var ordinal = 0;
        foreach (var block in Blocks(section))
        {
            if (Illustrative().IsMatch(block)) continue;
            if (!PyText.SplitLines(block).Any(l => GwtStart().IsMatch(l.Trim()))) continue;
            ordinal++;
            var (text, sourceRef) = SplitCitation(block, defaultRef);
            requirements.Add(new Requirement($"gwt-{ordinal}", text, "given-when-then", sourceRef));
        }
        return requirements;
    }

    private static List<Requirement> ParseProse(string section, string defaultRef)
    {
        var requirements = new List<Requirement>();
        var index = 0;
        foreach (var line in PyText.SplitLines(section))
        {
            index++;
            var match = Bullet().Match(line.Trim());
            if (!match.Success) continue;
            var (text, sourceRef) = SplitCitation(match.Groups[1].Value.Trim(), defaultRef);
            requirements.Add(new Requirement($"prose-{index}", text, "functional", sourceRef));
        }
        return requirements;
    }

    public static string RelativeSourceRef(string path, string repoRoot)
    {
        var relative = Path.GetRelativePath(repoRoot, path);
        return relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative) ? path : relative;
    }

    /// <summary>Locates the criteria section and tries each body parser in order; the first non-empty one wins.</summary>
    public static List<Requirement> ParseCriteria(string body, string defaultRef)
    {
        if (FindSection(body) is not { } section) return [];
        foreach (var parser in new Func<string, string, List<Requirement>>[] { ParseChecklist, ParseGivenWhenThen, ParseProse })
            if (parser(section, defaultRef) is { Count: > 0 } found) return found;
        return [];
    }
}
