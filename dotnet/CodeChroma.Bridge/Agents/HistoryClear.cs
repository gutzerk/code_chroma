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

/// <summary>Follows the user's keystrokes line by line: the draft a restart would lose, and a clear command submitted with Enter (CR); a line edited with cursor keys, completion, Ctrl+J or a pasted line break is unknown and never matches.</summary>
public sealed class TypedLine(IReadOnlyList<string> clearCommands)
{
    private const int MaxLine = 256;
    private const string PasteStart = "[200~";
    private const string PasteEnd = "[201~";

    private readonly StringBuilder _line = new();
    private readonly StringBuilder _escape = new();
    private bool _inEscape;
    private bool _inPaste;
    private bool _unknown;

    /// <summary>Whether the prompt holds a draft: typed text, or a line no longer known (history recall, a pasted line break).</summary>
    public bool HasDraft => _unknown || _line.Length > 0;

    /// <summary>Feeds one input chunk; true when a line the user submitted in it was a clear command; bridge-typed (`injected`) text joins the line unseen, so it never matches.</summary>
    public bool Feed(string data, bool injected = false)
    {
        if (injected)
        {
            if (data.Contains('\r')) Reset();
            else if (data.Length > 0) _unknown = true;
            return false;
        }
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
                case '\r' when !_inPaste:
                    cleared |= Submit();
                    break;
                case '\r' or '\n':
                    // Ctrl+J and a pasted line break add a line to the composer instead of submitting
                    _unknown = true;
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

    /// <summary>Bracketed-paste markers and the focus or SGR mouse reports the terminal sends on its own keep the line; any other sequence (arrows, Home) moves the cursor, so the line is no longer known.</summary>
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
        if (text == PasteStart) _inPaste = true;
        else if (text == PasteEnd) _inPaste = false;
        else if (text is not ("[I" or "[O") && !text.StartsWith("[<", StringComparison.Ordinal)) _unknown = true;
    }

    private bool Submit()
    {
        var text = _line.ToString().Trim();
        var match = !_unknown && text.Length > 0 && clearCommands.Contains(text.Split(' ', 2)[0], StringComparer.Ordinal);
        Reset();
        return match;
    }

    private void Reset()
    {
        _line.Clear();
        _unknown = false;
    }
}
