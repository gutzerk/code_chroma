namespace CodeChroma.Bridge.Context;

/// <summary>Output-size knobs of the context tool (the prototype's tuned values).</summary>
public static class ContextLimits
{
    public const int Seeds = 10;
    public const int MinEdgeWeight = 2;
    public const int MaxNeighbours = 12;
    public const int MaxFiles = 8;
    public const int MaxFilesNeighbour = 3;
    public const int MaxSymbols = 8;
    public const int MaxSymbolsNeighbour = 6;
    public const int MaxCalls = 12;
    public const int MaxBody = 200;
    public const int MaxArchBody = 260;
    public const int MaxUnlistedNames = 20;
}

public sealed record SymbolLine(string NodeId, string Name, bool IsClass, int Start, int End, IReadOnlyList<string> Calls);

public sealed record FileEntry(string Path, IReadOnlyList<SymbolLine> Symbols);

public sealed record PageInfo(string Id, string Name, string Container, string Title, string Description, IReadOnlyList<FileEntry> Files, IReadOnlyList<string> OtherFiles);

public sealed record ContainerInfo(string Id, string Name, string Purpose, string Description);

public sealed record EdgeInfo(string From, string To, int Count);

/// <summary>Everything the selector and renderer need, built once per wiki + graph state and stored beside the title embeddings.</summary>
public sealed record ContextData(
    string Fingerprint,
    IReadOnlyList<ContainerInfo> Containers,
    IReadOnlyList<PageInfo> Pages,
    IReadOnlyList<EdgeInfo> Edges);
