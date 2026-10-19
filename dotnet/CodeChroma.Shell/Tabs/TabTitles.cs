namespace CodeChroma.Shell;

/// <summary>Tab labels: "Project [Main]" for a repo tab, "Project [PR #42]" for a workspace tab sharing its bridge.</summary>
public static class TabTitles
{
    public static string For(TabModel model, Tab tab)
    {
        if (tab.RepoPath is not null) return $"{Folder(tab.RepoPath)} [Main]";
        if (tab.WorkspaceId is null && tab.Label is null) return "New Tab";
        var label = tab.Label ?? (tab.WorkspaceId!.StartsWith("pr-") ? $"PR #{tab.WorkspaceId[3..]}" : tab.WorkspaceId);
        var owner = tab.OwnerTabId is null ? null : model.FindTab(tab.OwnerTabId);
        return owner?.RepoPath is { } repo ? $"{Folder(repo)} [{label}]" : label;
    }

    public static string Folder(string repoPath)
    {
        var segments = repoPath.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
        return segments.Length == 0 ? repoPath : segments[^1];
    }
}
