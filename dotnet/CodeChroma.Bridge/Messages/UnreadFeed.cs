using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Messages;

/// <summary>One unread message as the panel shows it; Group (conversation or folder) is in-memory bookkeeping only.</summary>
public sealed record UnreadItem(
    string Id, string Source, string Where, string From, string Preview, DateTimeOffset At, string OpenUrl, string? WebUrl, string Group)
{
    public JsonObject ToJson() => new()
    {
        ["id"] = Id, ["source"] = Source, ["where"] = Where, ["from"] = From, ["preview"] = Preview,
        ["at"] = Json.Iso(At), ["open_url"] = OpenUrl, ["web_url"] = WebUrl,
    };
}

/// <summary>A source of unread messages: a full re-check plus a background loop that keeps the feed current.</summary>
public interface IMessageSource
{
    string Name { get; }

    /// <summary>Re-reads every unread message and replaces this source's slice of the feed.</summary>
    Task RecheckAsync(UnreadFeed feed, CancellationToken cancel);

    /// <summary>Runs until cancelled: the first full re-check, then pushes or polling.</summary>
    Task RunAsync(UnreadFeed feed, CancellationToken stop);
}

/// <summary>The in-memory unread list for every source; rebuilt on every start and never written to disk.</summary>
public sealed class UnreadFeed(Action changed)
{
    public static readonly string[] Sources = ["slack", "outlook"];

    private sealed class Slot
    {
        public string State = "disconnected";
        public string? Error;
        public DateTimeOffset? SyncedAt;
        public Dictionary<string, UnreadItem> Items = [];
    }

    private readonly Dictionary<string, Slot> _slots = Sources.ToDictionary(s => s, _ => new Slot());
    private readonly object _gate = new();

    /// <summary>Marks a source connected but not yet synced (its first re-check is running).</summary>
    public void Connecting(string source) => Mutate(source, slot =>
    {
        var changedState = slot.State != "connected" || slot.Error is not null;
        slot.State = "connected";
        slot.Error = null;
        return changedState;
    });

    /// <summary>Replaces the whole slice after a full re-check.</summary>
    public void Replace(string source, IEnumerable<UnreadItem> items, DateTimeOffset at) => ReplaceWhere(source, _ => true, items, at);

    /// <summary>Replaces the items matching scope (e.g. one conversation) with a fresh read of that scope.</summary>
    public void ReplaceWhere(string source, Func<UnreadItem, bool> scope, IEnumerable<UnreadItem> items, DateTimeOffset at) => Mutate(source, slot =>
    {
        var next = slot.Items.Values.Where(i => !scope(i)).ToDictionary(i => i.Id);
        foreach (var item in items) next[item.Id] = item;
        var changedItems = !SameItems(slot.Items, next);
        var changedState = slot.State != "connected" || slot.Error is not null;
        slot.Items = next;
        slot.State = "connected";
        slot.Error = null;
        slot.SyncedAt = at;
        return changedItems || changedState;
    });

    public void Upsert(string source, UnreadItem item) => Mutate(source, slot =>
    {
        if (slot.Items.TryGetValue(item.Id, out var old) && old == item) return false;
        slot.Items[item.Id] = item;
        return true;
    });

    public void RemoveWhere(string source, Func<UnreadItem, bool> match) => Mutate(source, slot =>
    {
        var gone = slot.Items.Values.Where(match).Select(i => i.Id).ToList();
        foreach (var id in gone) slot.Items.Remove(id);
        return gone.Count > 0;
    });

    /// <summary>Keeps the last good items but reports the error (a failed poll must not empty the list).</summary>
    public void Fail(string source, string error) => Mutate(source, slot =>
    {
        var changedState = slot.State != "error" || slot.Error != error;
        slot.State = "error";
        slot.Error = error;
        return changedState;
    });

    /// <summary>Drops a disconnected source's items and state.</summary>
    public void Clear(string source) => Mutate(source, slot =>
    {
        var had = slot.State != "disconnected" || slot.Items.Count > 0;
        slot.State = "disconnected";
        slot.Error = null;
        slot.SyncedAt = null;
        slot.Items = [];
        return had;
    });

    public IReadOnlyList<UnreadItem> Items(string source)
    {
        lock (_gate) return [.. _slots[source].Items.Values];
    }

    public (string State, string? Error) StateOf(string source)
    {
        lock (_gate) return (_slots[source].State, _slots[source].Error);
    }

    /// <summary>The GET /messages/unread body: per-source state plus every item, newest first.</summary>
    public JsonObject Snapshot()
    {
        lock (_gate)
        {
            var sources = new JsonObject();
            foreach (var (name, slot) in _slots)
                sources[name] = new JsonObject
                {
                    ["state"] = slot.State, ["error"] = slot.Error, ["synced_at"] = slot.SyncedAt is { } at ? Json.Iso(at) : null,
                };
            var items = new JsonArray([.. _slots.Values.SelectMany(s => s.Items.Values)
                .OrderByDescending(i => i.At).ThenBy(i => i.Id, StringComparer.Ordinal).Select(i => (JsonNode)i.ToJson())]);
            return new JsonObject { ["sources"] = sources, ["items"] = items };
        }
    }

    private void Mutate(string source, Func<Slot, bool> change)
    {
        bool fire;
        lock (_gate) fire = change(_slots[source]);
        if (fire) changed();
    }

    private static bool SameItems(Dictionary<string, UnreadItem> a, Dictionary<string, UnreadItem> b) =>
        a.Count == b.Count && a.All(pair => b.TryGetValue(pair.Key, out var other) && other == pair.Value);
}
