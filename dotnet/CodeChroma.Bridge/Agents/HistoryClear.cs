using System.Text;
using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Agents;

/// <summary>How an agent window notices its CLI's conversation was cleared: typed commands to watch (none when a hook reports it) and the input that repaints the screen.</summary>
public sealed record ClearWatch(IReadOnlyList<string> TypedCommands, string? Repaint)
{
    /// <summary>The adapter's clear definition; its typed commands are skipped when its hook reports a clear and `hooked` says the hooks are wired; null for no adapter.</summary>
    public static ClearWatch? For(ICliAdapter? adapter, bool hooked) =>
        adapter is null ? null : new ClearWatch(adapter.HookReportsClear && hooked ? [] : adapter.ClearCommands, adapter.RepaintInput);
}

/// <summary>Follows the user's keystrokes line by line and spots a submitted clear command; a line edited with cursor keys or completion is unknown and never matches.</summary>
public sealed class TypedClearDetector(IReadOnlyList<string> commands)
{
    private const int MaxLine = 256;
    /// <summary>The bracketed-paste start marker, after its ESC.</summary>
    internal const string PasteStart = "[200~";
    private const string PasteEnd = "[201~";

    private readonly StringBuilder _line = new();
    private readonly StringBuilder _escape = new();
    private bool _inEscape;
    private bool _unknown;

    /// <summary>Feeds one input chunk; true when a line submitted in it was a clear command.</summary>
    public bool Feed(string data)
    {
        var cleared = false;
        foreach (var ch in data)
        {
            if (_inEscape)
            {
                Escape(ch);
                continue;
            }
            switch (ch)
            {
                case '\u001b':
                    _inEscape = true;
                    _escape.Clear();
                    break;
                case '\r' or '\n':
                    cleared |= Submit();
                    break;
                case '\u007f' or '\b':
                    if (_line.Length > 0) _line.Length--;
                    break;
                case '\u0015' or '\u0003':
                    Reset();
                    break;
                default:
                    if (ch < ' ' || _line.Length >= MaxLine) _unknown = true;
                    else _line.Append(ch);
                    break;
            }
        }
        return cleared;
    }

    /// <summary>Bracketed-paste markers keep the line; any other sequence (arrows, Home, a mouse report) moves the cursor, so the line is no longer known.</summary>
    private void Escape(char ch)
    {
        _escape.Append(ch);
        var text = _escape.ToString();
        if (text.Length == 1 && ch is not '[' and not 'O')
        {
            _inEscape = false;
            _unknown = true;
            return;
        }
        if (text.Length < 2 || ch < '@' || ch > '~') return;
        _inEscape = false;
        if (text is not PasteStart and not PasteEnd) _unknown = true;
    }

    private bool Submit()
    {
        var text = _line.ToString().Trim();
        var match = !_unknown && text.Length > 0 && commands.Contains(text.Split(' ', 2)[0], StringComparer.Ordinal);
        Reset();
        return match;
    }

    private void Reset()
    {
        _line.Clear();
        _unknown = false;
    }
}
