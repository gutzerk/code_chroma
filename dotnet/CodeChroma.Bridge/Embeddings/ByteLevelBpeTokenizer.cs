using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CodeChroma.Bridge.Embeddings;

/// <summary>A RoBERTa-style byte-level BPE tokenizer read from a HuggingFace tokenizer.json, wrapping each text in &lt;s&gt; … &lt;/s&gt;.</summary>
public sealed partial class ByteLevelBpeTokenizer
{
    public const int MaxTokens = 512;

    private static readonly Dictionary<byte, char> ByteToChar = BuildByteMap();
    private readonly Dictionary<string, int> _vocab;
    private readonly Dictionary<(string, string), int> _ranks;
    private readonly Dictionary<string, string[]> _cache = [];
    private readonly int _bos, _eos, _unk;

    private ByteLevelBpeTokenizer(Dictionary<string, int> vocab, Dictionary<(string, string), int> ranks)
    {
        _vocab = vocab;
        _ranks = ranks;
        _bos = vocab["<s>"];
        _eos = vocab["</s>"];
        _unk = vocab.GetValueOrDefault("<unk>", _eos);
    }

    public int PadId => _vocab.GetValueOrDefault("<pad>", 1);

    public static ByteLevelBpeTokenizer Load(string tokenizerJsonPath)
    {
        using var doc = JsonDocument.Parse(File.ReadAllBytes(tokenizerJsonPath));
        var model = doc.RootElement.GetProperty("model");
        var vocab = model.GetProperty("vocab").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetInt32());
        var ranks = new Dictionary<(string, string), int>();
        var rank = 0;
        foreach (var merge in model.GetProperty("merges").EnumerateArray())
        {
            var pair = merge.ValueKind == JsonValueKind.String ? merge.GetString()!.Split(' ') : [merge[0].GetString()!, merge[1].GetString()!];
            ranks.TryAdd((pair[0], pair[1]), rank++);
        }
        return new ByteLevelBpeTokenizer(vocab, ranks);
    }

    /// <summary>Token ids for one text, truncated to <see cref="MaxTokens"/> including the two markers.</summary>
    public int[] Encode(string text)
    {
        var ids = new List<int>(32) { _bos };
        foreach (Match piece in PreTokenize().Matches(text))
        {
            var mapped = new string([.. Encoding.UTF8.GetBytes(piece.Value).Select(b => ByteToChar[b])]);
            foreach (var token in Bpe(mapped)) ids.Add(_vocab.GetValueOrDefault(token, _unk));
            if (ids.Count >= MaxTokens - 1) break;
        }
        if (ids.Count > MaxTokens - 1) ids.RemoveRange(MaxTokens - 1, ids.Count - (MaxTokens - 1));
        ids.Add(_eos);
        return [.. ids];
    }

    private string[] Bpe(string word)
    {
        if (_cache.TryGetValue(word, out var cached)) return cached;
        var parts = word.Select(c => c.ToString()).ToList();
        while (parts.Count > 1)
        {
            var best = -1;
            var bestRank = int.MaxValue;
            for (var i = 0; i < parts.Count - 1; i++)
                if (_ranks.TryGetValue((parts[i], parts[i + 1]), out var r) && r < bestRank) { bestRank = r; best = i; }
            if (best < 0) break;
            parts[best] += parts[best + 1];
            parts.RemoveAt(best + 1);
        }
        return _cache[word] = [.. parts];
    }

    /// <summary>The GPT-2 byte→printable-char table: printable bytes map to themselves, the rest shift above U+0100.</summary>
    private static Dictionary<byte, char> BuildByteMap()
    {
        var map = new Dictionary<byte, char>();
        var next = 256;
        for (var b = 0; b < 256; b++)
        {
            var printable = b is >= '!' and <= '~' or >= 0xA1 and <= 0xAC or >= 0xAE and <= 0xFF;
            map[(byte)b] = printable ? (char)b : (char)next++;
        }
        return map;
    }

    [GeneratedRegex(@"'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+")]
    private static partial Regex PreTokenize();
}
