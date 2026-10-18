namespace CodeChroma.Bridge.Workspaces;

/// <summary>Python's str.splitlines() and difflib.unified_diff line counting, so card line counts match.</summary>
public static class LineDiff
{
    /// <summary>Every character str.splitlines() treats as a line boundary.</summary>
    private static readonly HashSet<char> Breaks =
        [(char)0x0A, (char)0x0D, (char)0x0B, (char)0x0C, (char)0x1C, (char)0x1D, (char)0x1E, (char)0x85, (char)0x2028, (char)0x2029];

    /// <summary>str.splitlines(): splits on every Unicode line boundary Python recognizes, dropping the separators.</summary>
    public static List<string> SplitLines(string text)
    {
        var lines = new List<string>();
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (!Breaks.Contains(c)) continue;
            lines.Add(text[start..i]);
            if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
            start = i + 1;
        }
        if (start < text.Length) lines.Add(text[start..]);
        return lines;
    }

    /// <summary>The (added, removed) counts the Python card counter derives from `unified_diff(n=0)`.</summary>
    public static (int Added, int Removed) Delta(string original, string proposed)
    {
        var a = SplitLines(original);
        var b = SplitLines(proposed);
        var added = 0;
        var removed = 0;
        foreach (var (tag, i1, i2, j1, j2) in new SequenceMatcher(a, b).Opcodes())
        {
            if (tag == Tag.Equal) continue;
            // The counter skips any output line beginning with "+++" or "---" (it mistakes them for headers).
            if (tag is Tag.Replace or Tag.Delete) removed += a.Skip(i1).Take(i2 - i1).Count(line => !("-" + line).StartsWith("---", StringComparison.Ordinal));
            if (tag is Tag.Replace or Tag.Insert) added += b.Skip(j1).Take(j2 - j1).Count(line => !("+" + line).StartsWith("+++", StringComparison.Ordinal));
        }
        return (added, removed);
    }

    public enum Tag { Replace, Delete, Insert, Equal }

    /// <summary>A port of difflib.SequenceMatcher(None, a, b) with autojunk, enough for opcodes.</summary>
    private sealed class SequenceMatcher
    {
        private readonly List<string> _a;
        private readonly List<string> _b;
        private readonly Dictionary<string, List<int>> _b2j = [];

        public SequenceMatcher(List<string> a, List<string> b)
        {
            _a = a;
            _b = b;
            for (var i = 0; i < b.Count; i++)
            {
                if (!_b2j.TryGetValue(b[i], out var indices)) _b2j[b[i]] = indices = [];
                indices.Add(i);
            }
            if (b.Count < 200) return;
            var popularLimit = b.Count / 100 + 1;
            foreach (var key in _b2j.Where(kv => kv.Value.Count > popularLimit).Select(kv => kv.Key).ToList()) _b2j.Remove(key);
        }

        private (int I, int J, int K) LongestMatch(int alo, int ahi, int blo, int bhi)
        {
            int besti = alo, bestj = blo, bestsize = 0;
            var j2len = new Dictionary<int, int>();
            for (var i = alo; i < ahi; i++)
            {
                var newj2len = new Dictionary<int, int>();
                if (_b2j.TryGetValue(_a[i], out var indices))
                {
                    foreach (var j in indices)
                    {
                        if (j < blo) continue;
                        if (j >= bhi) break;
                        var k = newj2len[j] = (j2len.TryGetValue(j - 1, out var previous) ? previous : 0) + 1;
                        if (k > bestsize)
                        {
                            besti = i - k + 1;
                            bestj = j - k + 1;
                            bestsize = k;
                        }
                    }
                }
                j2len = newj2len;
            }
            while (besti > alo && bestj > blo && _a[besti - 1] == _b[bestj - 1]) { besti--; bestj--; bestsize++; }
            while (besti + bestsize < ahi && bestj + bestsize < bhi && _a[besti + bestsize] == _b[bestj + bestsize]) bestsize++;
            return (besti, bestj, bestsize);
        }

        private List<(int I, int J, int K)> MatchingBlocks()
        {
            var queue = new Stack<(int, int, int, int)>();
            queue.Push((0, _a.Count, 0, _b.Count));
            var blocks = new List<(int I, int J, int K)>();
            while (queue.Count > 0)
            {
                var (alo, ahi, blo, bhi) = queue.Pop();
                var (i, j, k) = LongestMatch(alo, ahi, blo, bhi);
                if (k == 0) continue;
                blocks.Add((i, j, k));
                if (alo < i && blo < j) queue.Push((alo, i, blo, j));
                if (i + k < ahi && j + k < bhi) queue.Push((i + k, ahi, j + k, bhi));
            }
            blocks.Sort();
            var collapsed = new List<(int I, int J, int K)>();
            int i1 = 0, j1 = 0, k1 = 0;
            foreach (var (i2, j2, k2) in blocks)
            {
                if (i1 + k1 == i2 && j1 + k1 == j2)
                {
                    k1 += k2;
                    continue;
                }
                if (k1 > 0) collapsed.Add((i1, j1, k1));
                (i1, j1, k1) = (i2, j2, k2);
            }
            if (k1 > 0) collapsed.Add((i1, j1, k1));
            collapsed.Add((_a.Count, _b.Count, 0));
            return collapsed;
        }

        public IEnumerable<(Tag Tag, int I1, int I2, int J1, int J2)> Opcodes()
        {
            int i = 0, j = 0;
            foreach (var (ai, bj, size) in MatchingBlocks())
            {
                Tag? tag = null;
                if (i < ai && j < bj) tag = Tag.Replace;
                else if (i < ai) tag = Tag.Delete;
                else if (j < bj) tag = Tag.Insert;
                if (tag is { } found) yield return (found, i, ai, j, bj);
                i = ai + size;
                j = bj + size;
                if (size > 0) yield return (Tag.Equal, ai, i, bj, j);
            }
        }
    }
}
