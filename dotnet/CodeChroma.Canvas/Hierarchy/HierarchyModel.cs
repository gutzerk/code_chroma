namespace CodeChroma.Canvas.Hierarchy;

/// <summary>One node of the architecture hierarchy as the canvas sees it (the web's HierarchyNodeRef).</summary>
public sealed record HierarchyItem(
    string Id,
    string Name,
    string Level,
    string? ParentId,
    bool HasChildren,
    string? Description = null,
    string? Params = null,
    string? SourcePath = null,
    string? Language = null,
    bool DocOnly = false);

/// <summary>Where the canvas reads the hierarchy from; the C# graph core backs it in the app, tests use a table.</summary>
public interface IHierarchySource
{
    HierarchyItem? Get(string id);
    IReadOnlyList<HierarchyItem> Children(string id);
}

public static class HierarchyIds
{
    /// <summary>The synthetic root whose children are the top-level Systems.</summary>
    public const string Root = "root";
}

/// <summary>A function's or file's source text as the code popup shows it.</summary>
public sealed record CodeSnippet(string NodeId, string Title, string? Params, string Language, string Text, int StartLine);

public interface ICodeSource
{
    CodeSnippet? Get(string nodeId);
}
