using System.Collections;

namespace CodeChroma.Core;

/// <summary>Insertion-ordered map: re-setting a key keeps its slot, like a Python dict (output order is part of parity).</summary>
internal sealed class OrderedMap<TKey, TValue> : IReadOnlyDictionary<TKey, TValue> where TKey : notnull
{
    private readonly Dictionary<TKey, int> _slot = [];
    private readonly List<KeyValuePair<TKey, TValue>> _items = [];

    public TValue this[TKey key]
    {
        get => _items[_slot[key]].Value;
        set
        {
            if (_slot.TryGetValue(key, out var slot)) _items[slot] = new(key, value);
            else
            {
                _slot[key] = _items.Count;
                _items.Add(new(key, value));
            }
        }
    }

    public int Count => _items.Count;
    public IEnumerable<TKey> Keys => _items.Select(i => i.Key);
    public IEnumerable<TValue> Values => _items.Select(i => i.Value);
    public bool ContainsKey(TKey key) => _slot.ContainsKey(key);

    public bool TryGetValue(TKey key, out TValue value)
    {
        if (_slot.TryGetValue(key, out var slot))
        {
            value = _items[slot].Value;
            return true;
        }
        value = default!;
        return false;
    }

    public void Clear()
    {
        _slot.Clear();
        _items.Clear();
    }

    public bool Remove(TKey key)
    {
        if (!_slot.Remove(key)) return false;
        _items.RemoveAll(i => EqualityComparer<TKey>.Default.Equals(i.Key, key));
        for (var i = 0; i < _items.Count; i++) _slot[_items[i].Key] = i;
        return true;
    }


    public IEnumerator<KeyValuePair<TKey, TValue>> GetEnumerator() => _items.GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

/// <summary>Insertion-ordered tally, the Counter the clustering votes with.</summary>
internal sealed class Counter
{
    private readonly OrderedMap<string, int> _counts = new();

    public int this[string key] => _counts.TryGetValue(key, out var n) ? n : 0;
    public int Count => _counts.Count;
    public IEnumerable<KeyValuePair<string, int>> Items => _counts;

    public void Add(string key, int amount = 1) => _counts[key] = this[key] + amount;

    /// <summary>The strict top vote-getter; null on an empty or tied vote.</summary>
    public string? Winner()
    {
        string? best = null;
        var bestCount = int.MinValue;
        var tied = false;
        foreach (var (key, count) in _counts)
        {
            if (count > bestCount) (best, bestCount, tied) = (key, count, false);
            else if (count == bestCount) tied = true;
        }
        return best is null || tied ? null : best;
    }

    /// <summary>Top n by count; ties keep insertion order, as Counter.most_common does.</summary>
    public List<string> MostCommon(int n) =>
        _counts.OrderByDescending(kv => kv.Value).Take(n).Select(kv => kv.Key).ToList();
}
