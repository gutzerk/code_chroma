using System.Globalization;
using System.Text;

namespace CodeChroma.Bridge.Terminal;

/// <summary>
/// A rendered virtual screen on top of a PTY stream, so a detector can read what the user sees and a reattaching window can be
/// redrawn from the current screen instead of a raw-byte replay (which can begin mid-CSI). Pure managed code on purpose.
/// </summary>
public sealed class ScreenTap
{
    public const string ProgressUnknown = "";
    public const string ProgressNone = "none";
    public const int DefaultRows = 24;
    public const int DefaultCols = 80;

    private const string Esc = "\u001b";
    private const int MaxParams = 16;
    private const int MaxOscLength = 4096;

    private enum Mode { Ground, Escape, Charset, Csi, Osc, OscEscape }

    private struct Cell
    {
        public string Data;
        public string Fg;
        public string Bg;
        public bool Bold, Italics, Underscore, Blink, Reverse, Strike;

        public readonly bool IsBlank => Data == " " && Fg == "default" && Bg == "default" && !Bold && !Italics && !Underscore && !Reverse;
        public readonly string StyleKey => $"{Fg}|{Bg}|{Bold}|{Italics}|{Underscore}|{Reverse}";
    }

    private static readonly Dictionary<string, int> SgrBase = new()
    {
        ["black"] = 0, ["red"] = 1, ["green"] = 2, ["brown"] = 3, ["blue"] = 4, ["magenta"] = 5, ["cyan"] = 6, ["white"] = 7,
    };

    private static readonly string[] BaseNames = ["black", "red", "green", "brown", "blue", "magenta", "cyan", "white"];

    private readonly object _gate = new();
    private Cell[][] _buffer;
    private int _x, _y;
    private int _savedX, _savedY;
    private bool _cursorHidden;
    private bool _wrapPending;
    private int _top, _bottom;
    private Cell _pen = BlankCell();
    private Mode _mode = Mode.Ground;
    private readonly StringBuilder _sequence = new();
    private string _progress = ProgressUnknown;

    public ScreenTap(int rows = DefaultRows, int cols = DefaultCols)
    {
        Rows = Math.Max(1, rows);
        Cols = Math.Max(1, cols);
        _buffer = NewBuffer(Rows, Cols);
        _bottom = Rows - 1;
    }

    public int Rows { get; private set; }

    public int Cols { get; private set; }

    /// <summary>Whatever the process last set via OSC 0/1/2; Claude puts its spinner state here.</summary>
    public string Title { get; private set; } = "";

    public string Progress => _progress;

    /// <summary>Never throws: a detector input must not be able to break the terminal it is watching.</summary>
    public void Feed(string chunk)
    {
        lock (_gate)
        {
            try
            {
                foreach (var ch in chunk) Step(ch);
            }
            catch (Exception)
            {
                _mode = Mode.Ground;
                _sequence.Clear();
            }
        }
    }

    public void Resize(int rows, int cols)
    {
        if (rows <= 0 || cols <= 0) return;
        lock (_gate)
        {
            var next = NewBuffer(rows, cols);
            for (var y = 0; y < Math.Min(rows, Rows); y++)
                Array.Copy(_buffer[y], next[y], Math.Min(cols, Cols));
            _buffer = next;
            Rows = rows;
            Cols = cols;
            _top = 0;
            _bottom = rows - 1;
            _x = Math.Min(_x, cols - 1);
            _y = Math.Min(_y, rows - 1);
            _wrapPending = false;
        }
    }

    /// <summary>The bottom `lines` rows of the rendered screen, trailing blanks trimmed off each.</summary>
    public string[] Tail(int lines)
    {
        lock (_gate)
        {
            if (lines <= 0) return [];
            var display = _buffer.Select(row => string.Concat(row.Select(c => c.Data)).TrimEnd()).ToArray();
            return display.Length <= lines ? display : display[^lines..];
        }
    }

    /// <summary>The whole screen redrawn as escape sequences, for a reattach that cannot start mid-CSI.</summary>
    public string Render()
    {
        lock (_gate)
        {
            var output = new StringBuilder(Esc + "[?25l" + Esc + "[H" + Esc + "[2J" + Esc + "[3J" + Esc + "[m");
            for (var y = 0; y < Rows; y++)
            {
                var cells = _buffer[y].ToList();
                while (cells.Count > 0 && cells[^1].IsBlank) cells.RemoveAt(cells.Count - 1);
                if (cells.Count == 0) continue;
                output.Append(Esc).Append('[').Append(y + 1).Append(";1H");
                string? style = null;
                foreach (var cell in cells)
                {
                    if (cell.StyleKey != style)
                    {
                        output.Append(CharSgr(cell));
                        style = cell.StyleKey;
                    }
                    output.Append(cell.Data);
                }
            }
            output.Append(Esc).Append("[m").Append(Esc).Append('[').Append(_y + 1).Append(';').Append(_x + 1).Append('H');
            if (!_cursorHidden) output.Append(Esc + "[?25h");
            return output.ToString();
        }
    }

    private static Cell BlankCell() => new() { Data = " ", Fg = "default", Bg = "default" };

    private static Cell[][] NewBuffer(int rows, int cols)
    {
        var buffer = new Cell[rows][];
        for (var y = 0; y < rows; y++) buffer[y] = BlankRow(cols);
        return buffer;
    }

    private static Cell[] BlankRow(int cols)
    {
        var row = new Cell[cols];
        Array.Fill(row, BlankCell());
        return row;
    }

    private void Step(char ch)
    {
        switch (_mode)
        {
            case Mode.Ground: Ground(ch); break;
            case Mode.Escape: EscapeStep(ch); break;
            case Mode.Charset: _mode = Mode.Ground; break;
            case Mode.Csi: CsiStep(ch); break;
            case Mode.Osc:
                if (ch == '\u0007') FinishOsc();
                else if (ch == '\u001b') _mode = Mode.OscEscape;
                else if (_sequence.Length < MaxOscLength) _sequence.Append(ch);
                break;
            case Mode.OscEscape:
                if (ch == '\\') FinishOsc();
                else
                {
                    _mode = Mode.Ground;
                    _sequence.Clear();
                    Ground(ch);
                }
                break;
        }
    }

    private void Ground(char ch)
    {
        switch (ch)
        {
            case '\u001b': _mode = Mode.Escape; return;
            case '\u0007': case '\u0000': case '\u000e': case '\u000f': return;
            case '\b': _x = Math.Max(0, _x - 1); _wrapPending = false; return;
            case '\t': _x = Math.Min(Cols - 1, (_x / 8 + 1) * 8); _wrapPending = false; return;
            case '\n': case '\u000b': case '\u000c': LineFeed(); return;
            case '\r': _x = 0; _wrapPending = false; return;
        }
        if (ch < ' ' || ch == '\u007f') return;
        Print(ch);
    }

    private void Print(char ch)
    {
        if (char.IsLowSurrogate(ch) && _x > 0 && _buffer[_y][_x - 1].Data.Length == 1 && char.IsHighSurrogate(_buffer[_y][_x - 1].Data[0]))
        {
            _buffer[_y][_x - 1].Data += ch;
            return;
        }
        if (_wrapPending)
        {
            _x = 0;
            LineFeed();
            _wrapPending = false;
        }
        var cell = _pen;
        cell.Data = ch.ToString();
        _buffer[_y][_x] = cell;
        if (_x < Cols - 1) _x++;
        else _wrapPending = true;
    }

    private void LineFeed()
    {
        _wrapPending = false;
        if (_y == _bottom) ScrollUp(1);
        else if (_y < Rows - 1) _y++;
    }

    private void ScrollUp(int lines)
    {
        for (var n = 0; n < lines; n++)
        {
            for (var y = _top; y < _bottom; y++) _buffer[y] = _buffer[y + 1];
            _buffer[_bottom] = BlankRow(Cols);
        }
    }

    private void ScrollDown(int lines)
    {
        for (var n = 0; n < lines; n++)
        {
            for (var y = _bottom; y > _top; y--) _buffer[y] = _buffer[y - 1];
            _buffer[_top] = BlankRow(Cols);
        }
    }

    private void EscapeStep(char ch)
    {
        _mode = Mode.Ground;
        switch (ch)
        {
            case '[': _mode = Mode.Csi; _sequence.Clear(); break;
            case ']': _mode = Mode.Osc; _sequence.Clear(); break;
            case '(': case ')': case '*': case '+': _mode = Mode.Charset; break;
            case '7': _savedX = _x; _savedY = _y; break;
            case '8': _x = _savedX; _y = _savedY; _wrapPending = false; break;
            case 'M':
                if (_y == _top) ScrollDown(1);
                else if (_y > 0) _y--;
                break;
            case 'D': LineFeed(); break;
            case 'E': _x = 0; LineFeed(); break;
            case 'c': Reset(); break;
            case '\u001b': _mode = Mode.Escape; break;
        }
    }

    private void Reset()
    {
        _buffer = NewBuffer(Rows, Cols);
        _x = _y = 0;
        _top = 0;
        _bottom = Rows - 1;
        _pen = BlankCell();
        _cursorHidden = false;
        _wrapPending = false;
    }

    private void CsiStep(char ch)
    {
        if (ch >= '@' && ch <= '~')
        {
            _mode = Mode.Ground;
            Dispatch(ch, _sequence.ToString());
            _sequence.Clear();
        }
        else if (ch == '\u001b')
        {
            _mode = Mode.Escape;
            _sequence.Clear();
        }
        else if (ch >= ' ' && _sequence.Length < MaxOscLength)
        {
            _sequence.Append(ch);
        }
    }

    private static int[] Params(string raw, int fallback)
    {
        var values = new List<int>();
        foreach (var part in raw.TrimStart('?', '>', '!').Split(';'))
        {
            var digits = new string(part.TakeWhile(char.IsDigit).ToArray());
            values.Add(int.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var value) ? Math.Min(value, 65535) : fallback);
            if (values.Count == MaxParams) break;
        }
        return [.. values];
    }

    private static int At(int[] values, int index, int fallback) => index < values.Length && values[index] > 0 ? values[index] : fallback;

    private void Dispatch(char final, string raw)
    {
        var privateMode = raw.StartsWith('?');
        var values = Params(raw, 0);
        _wrapPending = final is 'A' or 'B' or 'C' or 'D' or 'E' or 'F' or 'G' or 'H' or 'f' or 'd' ? false : _wrapPending;
        switch (final)
        {
            case 'A': _y = Math.Max(_top, _y - At(values, 0, 1)); break;
            case 'B': _y = Math.Min(_bottom, _y + At(values, 0, 1)); break;
            case 'C': _x = Math.Min(Cols - 1, _x + At(values, 0, 1)); break;
            case 'D': _x = Math.Max(0, _x - At(values, 0, 1)); break;
            case 'E': _y = Math.Min(_bottom, _y + At(values, 0, 1)); _x = 0; break;
            case 'F': _y = Math.Max(_top, _y - At(values, 0, 1)); _x = 0; break;
            case 'G': _x = Math.Clamp(At(values, 0, 1) - 1, 0, Cols - 1); break;
            case 'd': _y = Math.Clamp(At(values, 0, 1) - 1, 0, Rows - 1); break;
            case 'H': case 'f':
                _y = Math.Clamp(At(values, 0, 1) - 1, 0, Rows - 1);
                _x = Math.Clamp(At(values, 1, 1) - 1, 0, Cols - 1);
                break;
            case 'J': EraseDisplay(values.Length > 0 ? values[0] : 0); break;
            case 'K': EraseLine(values.Length > 0 ? values[0] : 0); break;
            case 'L': InsertLines(At(values, 0, 1)); break;
            case 'M': DeleteLines(At(values, 0, 1)); break;
            case 'P': DeleteChars(At(values, 0, 1)); break;
            case '@': InsertChars(At(values, 0, 1)); break;
            case 'X': EraseChars(At(values, 0, 1)); break;
            case 'S': ScrollUp(At(values, 0, 1)); break;
            case 'T': ScrollDown(At(values, 0, 1)); break;
            case 'r': SetScrollRegion(At(values, 0, 1), values.Length > 1 && values[1] > 0 ? values[1] : Rows); break;
            case 's': _savedX = _x; _savedY = _y; break;
            case 'u': _x = _savedX; _y = _savedY; break;
            case 'm': ApplySgr(raw); break;
            case 'h' when privateMode: SetPrivateModes(values, hidden: true); break;
            case 'l' when privateMode: SetPrivateModes(values, hidden: false); break;
        }
    }

    private void SetPrivateModes(int[] values, bool hidden)
    {
        if (values.Contains(25)) _cursorHidden = !hidden;
    }

    private void SetScrollRegion(int top, int bottom)
    {
        if (top >= bottom || bottom > Rows)
        {
            _top = 0;
            _bottom = Rows - 1;
        }
        else
        {
            _top = top - 1;
            _bottom = bottom - 1;
        }
        _x = _y = 0;
    }

    private void EraseDisplay(int mode)
    {
        switch (mode)
        {
            case 0:
                EraseLine(0);
                for (var y = _y + 1; y < Rows; y++) _buffer[y] = BlankRow(Cols);
                break;
            case 1:
                EraseLine(1);
                for (var y = 0; y < _y; y++) _buffer[y] = BlankRow(Cols);
                break;
            default:
                for (var y = 0; y < Rows; y++) _buffer[y] = BlankRow(Cols);
                break;
        }
    }

    private void EraseLine(int mode)
    {
        var (from, to) = mode switch { 0 => (_x, Cols - 1), 1 => (0, _x), _ => (0, Cols - 1) };
        for (var x = from; x <= to; x++) _buffer[_y][x] = BlankCell();
    }

    private void EraseChars(int count)
    {
        for (var x = _x; x < Math.Min(Cols, _x + count); x++) _buffer[_y][x] = BlankCell();
    }

    private void DeleteChars(int count)
    {
        var row = _buffer[_y];
        count = Math.Min(count, Cols - _x);
        Array.Copy(row, _x + count, row, _x, Cols - _x - count);
        for (var x = Cols - count; x < Cols; x++) row[x] = BlankCell();
    }

    private void InsertChars(int count)
    {
        var row = _buffer[_y];
        count = Math.Min(count, Cols - _x);
        Array.Copy(row, _x, row, _x + count, Cols - _x - count);
        for (var x = _x; x < _x + count; x++) row[x] = BlankCell();
    }

    private void InsertLines(int count)
    {
        if (_y < _top || _y > _bottom) return;
        count = Math.Min(count, _bottom - _y + 1);
        for (var y = _bottom; y >= _y + count; y--) _buffer[y] = _buffer[y - count];
        for (var y = _y; y < _y + count; y++) _buffer[y] = BlankRow(Cols);
        _x = 0;
    }

    private void DeleteLines(int count)
    {
        if (_y < _top || _y > _bottom) return;
        count = Math.Min(count, _bottom - _y + 1);
        for (var y = _y; y <= _bottom - count; y++) _buffer[y] = _buffer[y + count];
        for (var y = _bottom - count + 1; y <= _bottom; y++) _buffer[y] = BlankRow(Cols);
        _x = 0;
    }

    private void FinishOsc()
    {
        _mode = Mode.Ground;
        var text = _sequence.ToString();
        _sequence.Clear();
        var split = text.IndexOf(';');
        var code = split < 0 ? text : text[..split];
        var rest = split < 0 ? "" : text[(split + 1)..];
        if (code is "0" or "1" or "2") Title = rest;
        else if (code == "9" && rest.StartsWith("4;", StringComparison.Ordinal)) ReadProgress(rest[2..]);
    }

    private void ReadProgress(string rest)
    {
        var state = rest.Split(';')[0];
        _progress = state switch { "0" => ProgressNone, "1" or "3" => "running", "2" => "error", "4" => "warning", _ => ProgressNone };
    }

    private void ApplySgr(string raw)
    {
        var values = Params(raw, 0);
        for (var i = 0; i < values.Length; i++)
        {
            var n = values[i];
            switch (n)
            {
                case 0: _pen = BlankCell(); break;
                case 1: _pen.Bold = true; break;
                case 3: _pen.Italics = true; break;
                case 4: _pen.Underscore = true; break;
                case 5: _pen.Blink = true; break;
                case 7: _pen.Reverse = true; break;
                case 9: _pen.Strike = true; break;
                case 22: _pen.Bold = false; break;
                case 23: _pen.Italics = false; break;
                case 24: _pen.Underscore = false; break;
                case 25: _pen.Blink = false; break;
                case 27: _pen.Reverse = false; break;
                case 29: _pen.Strike = false; break;
                case 39: _pen.Fg = "default"; break;
                case 49: _pen.Bg = "default"; break;
                case >= 30 and <= 37: _pen.Fg = BaseNames[n - 30]; break;
                case >= 40 and <= 47: _pen.Bg = BaseNames[n - 40]; break;
                case >= 90 and <= 97: _pen.Fg = "bright" + BaseNames[n - 90]; break;
                case >= 100 and <= 107: _pen.Bg = "bright" + BaseNames[n - 100]; break;
                case 38 or 48:
                    var color = ExtendedColor(values, ref i);
                    if (color is not null) { if (n == 38) _pen.Fg = color; else _pen.Bg = color; }
                    break;
            }
        }
    }

    private static string? ExtendedColor(int[] values, ref int i)
    {
        if (i + 1 >= values.Length) return null;
        var kind = values[i + 1];
        if (kind == 5 && i + 2 < values.Length)
        {
            var index = values[i + 2];
            i += 2;
            return Xterm256(index);
        }
        if (kind == 2 && i + 4 < values.Length)
        {
            var hex = $"{Math.Min(values[i + 2], 255):x2}{Math.Min(values[i + 3], 255):x2}{Math.Min(values[i + 4], 255):x2}";
            i += 4;
            return hex;
        }
        return null;
    }

    private static string Xterm256(int index)
    {
        if (index < 8) return BaseNames[Math.Max(0, index)];
        if (index < 16) return "bright" + BaseNames[index - 8];
        if (index < 232)
        {
            int[] levels = [0, 95, 135, 175, 215, 255];
            var n = index - 16;
            return $"{levels[n / 36 % 6]:x2}{levels[n / 6 % 6]:x2}{levels[n % 6]:x2}";
        }
        var gray = 8 + (Math.Min(index, 255) - 232) * 10;
        return $"{gray:x2}{gray:x2}{gray:x2}";
    }

    private static string ColourSgr(string name, bool background)
    {
        var offset = background ? 40 : 30;
        if (name.StartsWith("bright", StringComparison.Ordinal) && SgrBase.TryGetValue(name[6..], out var bright)) return (offset + 60 + bright).ToString(CultureInfo.InvariantCulture);
        if (SgrBase.TryGetValue(name, out var basic)) return (offset + basic).ToString(CultureInfo.InvariantCulture);
        if (name.Length == 6 && name.All(Uri.IsHexDigit))
            return $"{offset + 8};2;{Convert.ToInt32(name[..2], 16)};{Convert.ToInt32(name[2..4], 16)};{Convert.ToInt32(name[4..], 16)}";
        return (offset + 9).ToString(CultureInfo.InvariantCulture);
    }

    private static string CharSgr(Cell cell)
    {
        var parts = new List<string> { "0" };
        if (cell.Bold) parts.Add("1");
        if (cell.Italics) parts.Add("3");
        if (cell.Underscore) parts.Add("4");
        if (cell.Blink) parts.Add("5");
        if (cell.Reverse) parts.Add("7");
        if (cell.Strike) parts.Add("9");
        parts.Add(ColourSgr(cell.Fg, background: false));
        parts.Add(ColourSgr(cell.Bg, background: true));
        return Esc + "[" + string.Join(';', parts) + "m";
    }
}
