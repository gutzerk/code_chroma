using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

namespace CodeChroma.Bridge.Agents;

/// <summary>One status's rules: the two OSC signals and the rendered-screen patterns.</summary>
public sealed record StatusSection(IReadOnlyList<Regex> TitleRegex, IReadOnlyList<Regex> ScreenRegex, IReadOnlySet<string> OscProgress)
{
    public static readonly StatusSection Empty = new([], [], new HashSet<string>());

    /// <summary>An empty progress is "never reported", so it is silence rather than a signal.</summary>
    public bool MatchesOsc(string title, string progress) =>
        (progress.Length > 0 && OscProgress.Contains(progress)) || TitleRegex.Any(p => p.IsMatch(title));

    public bool MatchesScreen(IEnumerable<string> tail)
    {
        var lines = tail as IReadOnlyCollection<string> ?? tail.ToList();
        return ScreenRegex.Any(pattern => lines.Any(pattern.IsMatch));
    }
}

/// <summary>A parsed detection manifest; an empty one classifies nothing, which degrades to "always hold".</summary>
public sealed class StatusRules
{
    public const int DefaultTailLines = 8;
    private static readonly string[] Sections = ["blocked", "working", "idle"];

    public string Name { get; init; } = "unknown";
    public IReadOnlyList<string> Process { get; init; } = [];
    public int TailLines { get; init; } = DefaultTailLines;
    public IReadOnlyDictionary<string, StatusSection> Sections_ { get; init; } = new Dictionary<string, StatusSection>();
    public StatusSection Transient { get; init; } = StatusSection.Empty;

    public StatusSection Section(string status) => Sections_.GetValueOrDefault(status) ?? StatusSection.Empty;

    /// <summary>The shipped manifest for an agent kind (embedded detect/&lt;kind&gt;.toml); an unknown kind never classifies.</summary>
    public static StatusRules ForKind(string kind)
    {
        using var stream = typeof(StatusRules).Assembly.GetManifestResourceStream($"detect/{kind}.toml");
        if (stream is null) return new StatusRules();
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return Parse(reader.ReadToEnd(), kind);
    }

    public static StatusRules Parse(string toml, string fallbackName = "unknown")
    {
        try
        {
            var tables = MiniToml.Parse(toml);
            var root = tables.GetValueOrDefault("") ?? [];
            return new StatusRules
            {
                Name = root.TryGetValue("name", out var name) && name.Count > 0 ? name[0] : fallbackName,
                Process = root.GetValueOrDefault("process") ?? [],
                TailLines = root.TryGetValue("tail_lines", out var tail) && tail.Count > 0 && int.TryParse(tail[0], out var n) && n > 0 ? n : DefaultTailLines,
                Sections_ = Sections.ToDictionary(s => s, s => ToSection(tables.GetValueOrDefault(s))),
                Transient = ToSection(tables.GetValueOrDefault("transient")),
            };
        }
        catch (Exception error) when (error is FormatException or ArgumentException)
        {
            return new StatusRules();
        }
    }

    private static StatusSection ToSection(Dictionary<string, List<string>>? table)
    {
        if (table is null) return StatusSection.Empty;
        return new StatusSection(Compile(table.GetValueOrDefault("title_regex")), Compile(table.GetValueOrDefault("screen_regex")),
            (table.GetValueOrDefault("osc_progress") ?? []).ToHashSet());
    }

    private static List<Regex> Compile(List<string>? patterns)
    {
        var compiled = new List<Regex>();
        foreach (var pattern in patterns ?? [])
        {
            try { compiled.Add(new Regex(pattern, RegexOptions.CultureInvariant)); }
            catch (ArgumentException) { /* an unparseable pattern is skipped, as in the Python loader */ }
        }
        return compiled;
    }
}

/// <summary>The TOML subset the detect manifests use: [tables], string scalars, integers and (multi-line) string arrays.</summary>
internal static class MiniToml
{
    public static Dictionary<string, Dictionary<string, List<string>>> Parse(string text)
    {
        var tables = new Dictionary<string, Dictionary<string, List<string>>> { [""] = [] };
        var current = tables[""];
        var lines = text.Replace("\r\n", "\n").Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var line = StripComment(lines[i]).Trim();
            if (line.Length == 0) continue;
            if (line.StartsWith('['))
            {
                if (!line.EndsWith(']')) throw new FormatException($"bad table header: {line}");
                var name = line[1..^1].Trim();
                if (!tables.TryGetValue(name, out current!)) tables[name] = current = [];
                continue;
            }
            var equals = line.IndexOf('=');
            if (equals < 0) throw new FormatException($"expected key = value: {line}");
            var key = line[..equals].Trim();
            var value = line[(equals + 1)..].Trim();
            while (value.StartsWith('[') && Depth(value) > 0)
            {
                if (++i >= lines.Length) throw new FormatException("unterminated array");
                value += " " + StripComment(lines[i]).Trim();
            }
            current[key] = Values(value);
        }
        return tables;
    }

    private static int Depth(string value)
    {
        var depth = 0;
        var inString = false;
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            if (inString)
            {
                if (c == '\\') i++;
                else if (c == '"') inString = false;
            }
            else if (c == '"') inString = true;
            else if (c == '[') depth++;
            else if (c == ']') depth--;
        }
        return depth;
    }

    private static string StripComment(string line)
    {
        var inString = false;
        for (var i = 0; i < line.Length; i++)
        {
            if (inString)
            {
                if (line[i] == '\\') i++;
                else if (line[i] == '"') inString = false;
            }
            else if (line[i] == '"') inString = true;
            else if (line[i] == '#') return line[..i];
        }
        return line;
    }

    private static List<string> Values(string value)
    {
        var result = new List<string>();
        if (!value.StartsWith('[')) { result.Add(Scalar(value)); return result; }
        var inner = value[1..value.LastIndexOf(']')];
        for (var i = 0; i < inner.Length; i++)
        {
            if (inner[i] == '"')
            {
                var builder = new StringBuilder();
                for (i++; i < inner.Length && inner[i] != '"'; i++)
                {
                    if (inner[i] != '\\') { builder.Append(inner[i]); continue; }
                    i++;
                    builder.Append(inner[i] switch
                    {
                        'n' => '\n', 't' => '\t', 'r' => '\r', '"' => '"', '\\' => '\\',
                        'u' => (char)Convert.ToInt32(inner.Substring(i + 1, 4), 16),
                        var other => throw new FormatException($"unsupported escape \\{other}"),
                    });
                    if (inner[i] == 'u') i += 4;
                }
                result.Add(builder.ToString());
            }
            else if (!char.IsWhiteSpace(inner[i]) && inner[i] != ',')
            {
                throw new FormatException($"unexpected character '{inner[i]}' in array");
            }
        }
        return result;
    }

    private static string Scalar(string value) => value.StartsWith('"') ? Values("[" + value + "]")[0] : value;
}

/// <summary>Holds one agent's status across observations, applying hysteresis and a send debounce.</summary>
public sealed class StatusDetector
{
    public const string Idle = "idle";
    public const string Blocked = "blocked";
    public const string Working = "working";
    private static readonly string[] Order = [Blocked, Working, Idle];

    private readonly double _hysteresis;
    private readonly double _minEmitInterval;
    private (string Status, double Since)? _pending;
    private double _lastEmit = double.NegativeInfinity;

    public StatusDetector(StatusRules rules, string initial = Idle, double hysteresisSeconds = 0.25, double minEmitIntervalSeconds = 0.25)
    {
        Rules = rules;
        Status = initial;
        _hysteresis = hysteresisSeconds;
        _minEmitInterval = minEmitIntervalSeconds;
    }

    public StatusRules Rules { get; }

    public string Status { get; private set; }

    /// <summary>The new status once it held for the hysteresis window, else null (nothing changed).</summary>
    public string? Observe(IReadOnlyList<string> tail, string title = "", string progress = "", string? process = null, double? now = null)
    {
        var moment = now ?? Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;
        string? candidate;
        try { candidate = Classify(tail, title, progress, process); }
        catch (Exception) { candidate = null; }
        if (candidate is null || candidate == Status)
        {
            _pending = null;
            return null;
        }
        if (_pending is not { } pending || pending.Status != candidate)
        {
            _pending = (candidate, moment);
            return null;
        }
        if (moment - pending.Since < _hysteresis) return null;
        if (moment - _lastEmit < _minEmitInterval) return null;
        Status = candidate;
        _pending = null;
        _lastEmit = moment;
        return candidate;
    }

    /// <summary>The status this observation implies, or null meaning "hold whatever is current".</summary>
    public string? Classify(IReadOnlyList<string> tail, string title, string progress, string? process)
    {
        if (Rules.Process.Count > 0 && process is not null && !Rules.Process.Contains(process)) return null;
        if (Rules.Transient.MatchesScreen(tail)) return null;
        foreach (var status in Order)
            if (Rules.Section(status).MatchesOsc(title, progress)) return status;
        foreach (var status in Order)
            if (Rules.Section(status).MatchesScreen(tail)) return status;
        return null;
    }

    /// <summary>Sets the status from outside the rules: the manager owns stopped/exited/running.</summary>
    public void Force(string status)
    {
        Status = status;
        _pending = null;
    }
}
