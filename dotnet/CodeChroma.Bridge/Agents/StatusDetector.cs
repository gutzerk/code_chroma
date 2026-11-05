using System.Collections;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Tomlyn;
using Tomlyn.Model;

namespace CodeChroma.Bridge.Agents;

/// <summary>One matcher node: every own matcher, every All, one Any (if any) and no Not must hold (herdr's gate).</summary>
public sealed record DetectGate(
    IReadOnlyList<string> Contains, IReadOnlyList<Regex> Regex, IReadOnlyList<Regex> LineRegex,
    IReadOnlyList<DetectGate> All, IReadOnlyList<DetectGate> Any, IReadOnlyList<DetectGate> Not)
{
    public bool Matches(RegionText region)
    {
        if (!Contains.All(region.Lower.Contains)) return false;
        if (!Regex.All(pattern => pattern.IsMatch(region.Text))) return false;
        if (LineRegex.Count > 0 && !LineRegex.All(pattern => region.Lines.Any(pattern.IsMatch))) return false;
        if (!All.All(nested => nested.Matches(region))) return false;
        if (Any.Count > 0 && !Any.Any(nested => nested.Matches(region))) return false;
        return !Not.Any(nested => nested.Matches(region));
    }
}

/// <summary>One region's text plus its lower-cased form and lines, each computed at most once.</summary>
public sealed class RegionText(string text)
{
    private string? _lower;
    private List<string>? _lines;

    public string Text { get; } = text;

    public string Lower => _lower ??= Text.ToLowerInvariant();

    public IReadOnlyList<string> Lines => _lines ??= DetectScreen.Lines(Text);
}

internal static class TomlValues
{
    /// <summary>The key's value, or null when the table lacks it.</summary>
    public static object? Value(this TomlTable table, string key) => table.TryGetValue(key, out var value) ? value : null;
}

/// <summary>One [[rules]] entry of a detect manifest.</summary>
public sealed record DetectRule(
    string Id, string State, int Priority, string Region, DetectGate Gate,
    bool VisibleIdle = false, bool VisibleBlocker = false, bool SkipStateUpdate = false);

/// <summary>One verdict: the state (null = hold) plus herdr's visible-chrome flags and the rule that won.</summary>
public sealed record DetectClassification(string? State, bool VisibleIdle = false, bool VisibleBlocker = false, string? RuleId = null)
{
    public static readonly DetectClassification Hold = new((string?)null);
}

/// <summary>A parsed herdr-style detection manifest; an empty one classifies nothing, which degrades to "always hold".</summary>
public sealed class StatusRules
{
    public const int DefaultTailLines = 8;
    public const string StateUnknown = "unknown";
    private static readonly HashSet<string> States = [AgentStatus.Idle, AgentStatus.Blocked, AgentStatus.Working, StateUnknown];
    private static readonly HashSet<string> GateKeys = ["all", "any", "not", "contains", "regex", "line_regex"];
    private static readonly HashSet<string> RuleKeys =
        [.. GateKeys, "id", "state", "priority", "region", "visible_idle", "visible_blocker", "visible_working", "skip_state_update"];
    private static readonly ConcurrentDictionary<string, StatusRules> Shipped = new();
    private static readonly TimeSpan MatchTimeout = TimeSpan.FromMilliseconds(250);

    public string Name { get; init; } = "unknown";
    public IReadOnlyList<string> Process { get; init; } = [];
    public int TailLines { get; init; } = DefaultTailLines;
    /// <summary>Highest priority first, file order breaking ties, so the first match is the winner.</summary>
    public IReadOnlyList<DetectRule> Rules { get; init; } = [];
    public IReadOnlyList<string> Aliases { get; init; } = [];

    /// <summary>What no matching rule means: null holds, "idle" is herdr's known-agent fallback.</summary>
    public string? NoMatch { get; init; }

    /// <summary>False for an unknown kind's empty rules, which never report idle.</summary>
    public bool Classifies => Rules.Count > 0;

    /// <summary>The shipped manifest for an agent kind or alias (embedded detect/&lt;kind&gt;.toml); an unknown kind never classifies.</summary>
    public static StatusRules ForKind(string kind) => Shipped.GetOrAdd(kind, Load);

    private static StatusRules Load(string kind)
    {
        if (ReadShipped($"detect/{kind}.toml") is { } direct) return Parse(direct, kind);
        var assembly = typeof(StatusRules).Assembly;
        foreach (var name in assembly.GetManifestResourceNames().Where(n => n.StartsWith("detect/", StringComparison.Ordinal) && n.EndsWith(".toml", StringComparison.Ordinal)).Order(StringComparer.Ordinal))
        {
            var rules = Parse(ReadShipped(name) ?? "", Path.GetFileNameWithoutExtension(name));
            if (rules.Aliases.Contains(kind)) return rules;
        }
        return new StatusRules();
    }

    private static string? ReadShipped(string resource)
    {
        using var stream = typeof(StatusRules).Assembly.GetManifestResourceStream(resource);
        if (stream is null) return null;
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd();
    }

    /// <summary>Parses manifest text; anything malformed (TOML, key, state, region or regex) yields rules that never classify.</summary>
    public static StatusRules Parse(string toml, string fallbackName = "unknown")
    {
        try { return ParseStrict(toml, fallbackName); }
        catch (Exception error) when (error is TomlException or FormatException or ArgumentException or InvalidCastException or InvalidOperationException)
        {
            Console.Error.WriteLine($"agent status: malformed manifest {fallbackName} ({error.Message}) - the detector will hold");
            return new StatusRules();
        }
    }

    private static StatusRules ParseStrict(string toml, string fallbackName)
    {
        var root = TomlSerializer.Deserialize<TomlTable>(toml) ?? throw new FormatException("empty manifest");
        var noMatch = root.TryGetValue("no_match", out var nm) ? nm as string ?? throw new FormatException("no_match must be a string") : "hold";
        if (noMatch is not ("hold" or AgentStatus.Idle)) throw new FormatException($"no_match must be 'hold' or 'idle', not '{noMatch}'");
        var rules = Tables(root.Value("rules")).Select(ToRule).OrderByDescending(rule => rule.Priority).ToList();
        if (rules.Count == 0) throw new FormatException("a manifest needs at least one [[rules]] entry");
        return new StatusRules
        {
            Name = root.Value("id") as string ?? root.Value("name") as string ?? fallbackName,
            Process = Strings(root.Value("process")),
            TailLines = root.Value("tail_lines") is long tail && tail > 0 ? (int)tail : DefaultTailLines,
            Rules = rules,
            Aliases = Strings(root.Value("aliases")),
            NoMatch = noMatch == AgentStatus.Idle ? AgentStatus.Idle : null,
        };
    }

    private static DetectRule ToRule(TomlTable raw)
    {
        if (raw.Keys.FirstOrDefault(k => !RuleKeys.Contains(k)) is { } unknown) throw new FormatException($"unknown rule key '{unknown}'");
        var state = raw.Value("state") as string ?? StateUnknown;
        if (!States.Contains(state)) throw new FormatException($"unknown state '{state}'");
        var region = (raw.Value("region") as string ?? "whole_recent").Trim();
        if (!DetectScreen.IsValidRegion(region)) throw new FormatException($"unknown region '{region}'");
        var priority = raw.Value("priority") switch { null => 0L, long p => p, _ => throw new FormatException("priority must be an integer") };
        // herdr's visible_working is accepted and type-checked but unused here
        Flag(raw, "visible_working");
        return new DetectRule(
            raw.Value("id") as string ?? throw new FormatException("a rule needs an id"), state, checked((int)priority), region, ToGate(raw, rule: true),
            Flag(raw, "visible_idle"), Flag(raw, "visible_blocker"), Flag(raw, "skip_state_update"));
    }

    private static DetectGate ToGate(TomlTable raw, bool rule = false)
    {
        var allowed = rule ? RuleKeys : GateKeys;
        if (raw.Keys.FirstOrDefault(k => !allowed.Contains(k)) is { } unknown) throw new FormatException($"unknown gate key '{unknown}'");
        return new DetectGate(
            Strings(raw.Value("contains")).Select(needle => needle.ToLowerInvariant()).ToList(),
            Strings(raw.Value("regex")).Select(Compile).ToList(),
            Strings(raw.Value("line_regex")).Select(Compile).ToList(),
            Tables(raw.Value("all")).Select(t => ToGate(t)).ToList(),
            Tables(raw.Value("any")).Select(t => ToGate(t)).ToList(),
            Tables(raw.Value("not")).Select(t => ToGate(t)).ToList());
    }

    private static Regex Compile(string pattern) => new(pattern, RegexOptions.CultureInvariant, MatchTimeout);

    private static bool Flag(TomlTable raw, string key) => raw.Value(key) switch
    {
        null => false,
        bool value => value,
        _ => throw new FormatException($"{key} must be a boolean"),
    };

    private static List<string> Strings(object? value) => value switch
    {
        null => [],
        string => throw new FormatException("expected an array of strings"),
        IEnumerable items => items.Cast<object?>().Select(item => item as string ?? throw new FormatException("expected a string")).ToList(),
        _ => throw new FormatException("expected an array of strings"),
    };

    private static List<TomlTable> Tables(object? value) => value switch
    {
        null => [],
        IEnumerable items when (value is not string) && (value is not TomlTable) =>
            items.Cast<object?>().Select(item => item as TomlTable ?? throw new FormatException("expected a table")).ToList(),
        _ => throw new FormatException("expected an array of tables"),
    };

    /// <summary>The winning rule's verdict over this screen and OSC state, ignoring the process filter.</summary>
    public DetectClassification Evaluate(IReadOnlyList<string> tail, string title = "", string progress = "")
    {
        if (Rules.Count == 0) return DetectClassification.Hold;
        var screen = new DetectScreen(tail);
        var best = Rules.FirstOrDefault(rule => rule.Gate.Matches(screen.Slice(rule.Region, title, progress)));
        if (best is null) return new DetectClassification(NoMatch);
        if (best.SkipStateUpdate || best.State == StateUnknown) return new DetectClassification(null, RuleId: best.Id);
        return new DetectClassification(best.State,
            VisibleIdle: best.VisibleIdle && best.State == AgentStatus.Idle,
            VisibleBlocker: best.VisibleBlocker && best.State == AgentStatus.Blocked,
            RuleId: best.Id);
    }
}

/// <summary>The tail as one text (trailing blank rows dropped) plus herdr's region slicers over it (src/detect/manifest.rs `fn region`).</summary>
public sealed class DetectScreen
{
    /// <summary>The largest line count a counted region may name; a screen never holds more.</summary>
    public const int MaxRegionLines = 10_000;

    private static readonly Regex Counted = new(@"^(bottom_lines|bottom_non_empty_lines|top_non_empty_lines)\(([0-9]+)\)$", RegexOptions.CultureInvariant);
    private static readonly HashSet<string> Plain =
    [
        "whole_recent", "after_last_prompt_marker", "before_current_prompt_marker", "whole_recent_without_current_prompt_marker",
        "current_prompt_block_marker", "after_current_prompt_block_marker", "prompt_box_body", "above_prompt_box",
        "last_non_empty_above_prompt_box", "after_last_horizontal_rule", "osc_title", "osc_progress",
    ];

    private readonly List<string> _lines;
    private readonly string _content;
    private readonly Dictionary<string, RegionText> _slices = [];
    private (bool Known, int? Index) _currentPrompt;
    private (bool Known, int? Index) _promptBoxTop;

    public DetectScreen(IReadOnlyList<string> tail)
    {
        _lines = [.. tail];
        while (_lines.Count > 0 && string.IsNullOrWhiteSpace(_lines[^1])) _lines.RemoveAt(_lines.Count - 1);
        _content = string.Join("\n", _lines);
    }

    public static bool IsValidRegion(string spec) =>
        Plain.Contains(spec) || (Counted.Match(spec) is { Success: true } m && !m.Groups[2].Value.StartsWith('0')
            && int.TryParse(m.Groups[2].Value, out var count) && count <= MaxRegionLines);

    /// <summary>Rust's str::lines: split on \n, drop one trailing empty piece, strip a trailing \r.</summary>
    public static List<string> Lines(string text)
    {
        if (text.Length == 0) return [];
        var pieces = text.Split('\n').ToList();
        if (text.EndsWith('\n')) pieces.RemoveAt(pieces.Count - 1);
        return pieces.Select(p => p.EndsWith('\r') ? p[..^1] : p).ToList();
    }

    /// <summary>The region as a memoized RegionText: each screen region is sliced once per screen, OSC regions pass straight through.</summary>
    public RegionText Slice(string spec, string title, string progress)
    {
        if (spec is "osc_title" or "osc_progress") return new RegionText(Region(spec, title, progress));
        if (!_slices.TryGetValue(spec, out var slice)) _slices[spec] = slice = new RegionText(Region(spec, title, progress));
        return slice;
    }

    public string Region(string spec, string title, string progress)
    {
        switch (spec)
        {
            case "osc_title": return title;
            case "osc_progress": return progress;
            case "whole_recent": return _content;
            case "after_last_prompt_marker": return LastIndex(IsCodexPrompt) is { } p ? Suffix(p + 1) : _content;
            case "before_current_prompt_marker": return CurrentPromptIndex() is { } c ? Prefix(c) : _content;
            case "whole_recent_without_current_prompt_marker": return CurrentPromptIndex() is null ? _content : "";
            case "current_prompt_block_marker": return BlockIndex() is { } b ? _lines[b] : "";
            case "after_current_prompt_block_marker": return BlockIndex() is { } a ? Suffix(a) : "";
            case "prompt_box_body": return PromptBoxBody();
            case "above_prompt_box": return AbovePromptBox();
            case "last_non_empty_above_prompt_box": return Lines(AbovePromptBox()).LastOrDefault(l => l.Trim().Length > 0) ?? "";
            case "after_last_horizontal_rule": return LastIndex(IsHorizontalRule) is { } r ? Suffix(r + 1) : _content;
        }
        var counted = Counted.Match(spec);
        if (!counted.Success) return "";
        var count = int.Parse(counted.Groups[2].Value);
        if (counted.Groups[1].Value == "bottom_lines") return Suffix(Math.Max(_lines.Count - count, 0));
        var nonEmpty = Enumerable.Range(0, _lines.Count).Where(i => _lines[i].Trim().Length > 0).ToList();
        if (nonEmpty.Count == 0) return "";
        return counted.Groups[1].Value == "bottom_non_empty_lines"
            ? Suffix(nonEmpty[Math.Max(nonEmpty.Count - count, 0)])
            : Prefix(nonEmpty[Math.Min(count, nonEmpty.Count) - 1] + 1);
    }

    private string Suffix(int index) => string.Join("\n", _lines.Skip(index));

    private string Prefix(int index) => string.Concat(_lines.Take(index).Select(l => l + "\n"));

    private int? LastIndex(Func<string, bool> predicate)
    {
        for (var i = _lines.Count - 1; i >= 0; i--)
            if (predicate(_lines[i])) return i;
        return null;
    }

    private int? CurrentPromptIndex()
    {
        if (!_currentPrompt.Known) _currentPrompt = (true, FindCurrentPrompt());
        return _currentPrompt.Index;
    }

    private int? FindCurrentPrompt()
    {
        if (LastIndex(IsCodexPrompt) is not { } prompt) return null;
        return _lines.Skip(prompt + 1).Any(IsCodexBlockMarker) ? null : prompt;
    }

    private int? BlockIndex()
    {
        if (CurrentPromptIndex() is not { } prompt) return null;
        for (var i = prompt - 1; i >= 0; i--)
            if (IsCodexBlockMarker(_lines[i])) return i;
        return null;
    }

    private int? PromptBoxTop()
    {
        if (!_promptBoxTop.Known) _promptBoxTop = (true, FindPromptBoxTop());
        return _promptBoxTop.Index;
    }

    private int? FindPromptBoxTop()
    {
        var seen = 0;
        for (var i = _lines.Count - 1; i >= 0; i--)
            if (IsHorizontalRule(_lines[i]) && ++seen == 2) return i;
        return null;
    }

    private string PromptBoxBody()
    {
        if (PromptBoxTop() is not { } top) return "";
        var end = top + 1;
        while (end < _lines.Count && !IsHorizontalRule(_lines[end])) end++;
        return string.Concat(_lines.Skip(top + 1).Take(end - top - 1).Select(l => l + "\n"));
    }

    private string AbovePromptBox() => PromptBoxTop() is { } top ? Prefix(top) : _content;

    private static bool IsCodexPrompt(string line) => line == "›" || line.StartsWith("› ", StringComparison.Ordinal);

    private static bool IsCodexBlockMarker(string line) => line.Length > 0 && line[0] is '•' or '■' or '✗' or '✓';

    public static bool IsHorizontalRule(string line)
    {
        var trimmed = line.Trim();
        if (trimmed.Length == 0) return false;
        var run = 0;
        while (run < trimmed.Length && trimmed[run] == '─') run++;
        if (run == 0) return false;
        return trimmed[run..].TrimStart().Length == 0 || run >= 3;
    }
}

/// <summary>Holds one agent's status across observations: herdr's working-to-idle confirmation, hysteresis and a send debounce.</summary>
public sealed class StatusDetector
{
    public const int IdleConfirmations = 3;
    public const double IdleConfirmationCapSeconds = 0.7;

    private readonly double _hysteresis;
    private readonly double _minEmitInterval;
    private (string Status, double Since)? _pending;
    private double _lastEmit = double.NegativeInfinity;
    private double? _idleStarted;
    private int _idleConfirmations;
    private volatile DetectClassification _last = DetectClassification.Hold;

    public StatusDetector(StatusRules rules, string initial = AgentStatus.Idle, double hysteresisSeconds = 0.25, double minEmitIntervalSeconds = 0.25)
    {
        Rules = rules;
        Status = initial;
        _hysteresis = hysteresisSeconds;
        _minEmitInterval = minEmitIntervalSeconds;
    }

    public StatusRules Rules { get; }

    public string Status { get; private set; }

    /// <summary>True when the last classification saw a blocking dialog on screen, so hook reports can defer to it.</summary>
    public bool LastVisibleBlocker => _last.VisibleBlocker;

    public DetectClassification LastClassification => _last;

    /// <summary>The new status once it held for the hysteresis window, else null (nothing changed).</summary>
    public string? Observe(IReadOnlyList<string> tail, string title = "", string progress = "", string? process = null, double? now = null) =>
        Settle(Evaluate(tail, title, progress, process), now);

    /// <summary>Runs one verdict through the hysteresis: the new status once it held long enough, else null; a cached verdict may be settled again.</summary>
    public string? Settle(DetectClassification verdict, double? now = null)
    {
        var moment = now ?? Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;
        _last = verdict;
        var candidate = verdict.State;
        if (candidate is null || candidate == Status)
        {
            _pending = null;
            ClearIdleGate();
            return null;
        }
        var holdIdle = HoldWorkingToIdle(candidate, moment);
        if (_pending is not { } pending || pending.Status != candidate)
        {
            _pending = (candidate, moment);
            return null;
        }
        if (holdIdle || moment - pending.Since < _hysteresis) return null;
        if (moment - _lastEmit < _minEmitInterval) return null;
        Status = candidate;
        _pending = null;
        _lastEmit = moment;
        ClearIdleGate();
        return candidate;
    }

    /// <summary>The status this observation implies, or null meaning "hold whatever is current".</summary>
    public string? Classify(IReadOnlyList<string> tail, string title, string progress, string? process)
    {
        _last = Judge(tail, title, progress, process);
        return _last.State;
    }

    /// <summary>This observation's verdict without touching the detector; a foreign process or a failing rule holds.</summary>
    public DetectClassification Evaluate(IReadOnlyList<string> tail, string title, string progress, string? process)
    {
        try { return Judge(tail, title, progress, process); }
        catch (Exception) { return DetectClassification.Hold; }
    }

    private DetectClassification Judge(IReadOnlyList<string> tail, string title, string progress, string? process) =>
        Rules.Process.Count > 0 && process is not null && !Rules.Process.Contains(process)
            ? DetectClassification.Hold
            : Rules.Evaluate(tail, title, progress);

    /// <summary>Sets the status from outside the rules: hooks, once reporting, own working and idle; the same status keeps a pending verdict settling.</summary>
    public void Force(string status)
    {
        if (Status == status) return;
        Status = status;
        _pending = null;
        ClearIdleGate();
    }

    /// <summary>herdr's PendingIdleConfirmation: a plain (not visibly idle) idle after working needs repeat sightings or the cap.</summary>
    private bool HoldWorkingToIdle(string candidate, double moment)
    {
        var last = _last;
        if (!(Status == AgentStatus.Working && candidate == AgentStatus.Idle && !last.VisibleIdle && !last.VisibleBlocker))
        {
            ClearIdleGate();
            return false;
        }
        if (_idleStarted is not { } started)
        {
            _idleStarted = moment;
            _idleConfirmations = 0;
            return true;
        }
        if (moment - started >= IdleConfirmationCapSeconds) return false;
        return ++_idleConfirmations < IdleConfirmations;
    }

    private void ClearIdleGate()
    {
        _idleStarted = null;
        _idleConfirmations = 0;
    }
}
