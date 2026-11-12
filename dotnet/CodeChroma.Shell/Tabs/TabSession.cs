using System.Text.Json;

namespace CodeChroma.Shell;

/// <summary>One saved tab: a project, or a PR workspace tab when WorkspaceId is set (RepoPath is then its owner's repo).</summary>
public sealed record SessionTab(string RepoPath, string? WorkspaceId = null, string? Label = null);

public sealed record SessionState(IReadOnlyList<SessionTab> Tabs, int ActiveIndex)
{
    public static readonly SessionState Empty = new([], -1);

    public SessionTab? Active => ActiveIndex >= 0 && ActiveIndex < Tabs.Count ? Tabs[ActiveIndex] : null;
}

/// <summary>The tabs open at the last change, kept in session.json so the next launch reopens them.</summary>
public static class TabSession
{
    public static string StorePath(string userDataDir) => Path.Combine(userDataDir, "session.json");

    public static SessionState Capture(TabModel tabs)
    {
        var saved = new List<SessionTab>();
        var active = -1;
        foreach (var tab in tabs.Tabs)
        {
            SessionTab? entry = tab switch
            {
                { RepoPath: { } repo } => new SessionTab(repo),
                { WorkspaceId: { } id, OwnerTabId: { } owner } when tabs.FindTab(owner)?.RepoPath is { } repo => new SessionTab(repo, id, tab.Label),
                _ => null,
            };
            if (entry is null) continue;
            if (tab.Id == tabs.ActiveTab?.Id) active = saved.Count;
            saved.Add(entry);
        }
        return new SessionState(saved, active);
    }

    public static string Serialize(SessionState state)
    {
        var shaped = new
        {
            active = state.ActiveIndex,
            tabs = state.Tabs.Select(t => new Dictionary<string, string?> { ["repo"] = t.RepoPath, ["workspace"] = t.WorkspaceId, ["label"] = t.Label }
                .Where(p => p.Value is not null).ToDictionary()),
        };
        return JsonSerializer.Serialize(shaped, Indented);
    }

    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

    public static void Write(string storePath, string json)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(storePath)!);
        var temp = storePath + ".tmp";
        File.WriteAllText(temp, json);
        File.Move(temp, storePath, overwrite: true);
    }

    public static SessionState Read(string storePath)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(storePath));
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("tabs", out var items) || items.ValueKind != JsonValueKind.Array) return SessionState.Empty;
            var active = root.TryGetProperty("active", out var a) && a.TryGetInt32(out var index) ? index : -1;
            var tabs = new List<SessionTab>();
            var activeTab = -1;
            var position = 0;
            foreach (var item in items.EnumerateArray())
            {
                var here = position++;
                if (item.ValueKind != JsonValueKind.Object || JsonFields.Text(item, "repo") is not { } repo || !Path.IsPathRooted(repo)) continue;
                if (here == active) activeTab = tabs.Count;
                tabs.Add(new SessionTab(repo, JsonFields.Text(item, "workspace"), JsonFields.Text(item, "label")));
            }
            return new SessionState(tabs, activeTab);
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return SessionState.Empty;
        }
    }
}
