using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace CodeChroma.Bridge.Http;

public sealed record NodeRef(
    string NodeId, string Name, string Level, string? ParentId, bool HasChildren, int ChildCount,
    string? Source, string? Language, bool DocOnly);

public sealed record RootRef(
    string NodeId, string Name, string Level, string? ParentId, bool HasChildren, int ChildCount);

public sealed record Connection(string FromId, string ToId, string FromTo, string? Origin);

public sealed class StructureEntry
{
    public required string NodeId { get; init; }
    public required string Path { get; init; }
    public required string Name { get; init; }
    public required string Level { get; init; }
    public string? Summary { get; init; }
    public bool DocOnly { get; init; }
    public int ChildCount { get; set; }
    public bool Truncated { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<StructureEntry>? Children { get; set; }
}

public sealed record StructureResponse(string Root, int Depth, bool Truncated, List<StructureEntry> Nodes);

public sealed record SourceFragment(string Path, string Content, string? Language);

public sealed record WorkspaceStatus(string Id, string State, string Progress, string? Error, bool ReadOnly);

public sealed record WorkspaceActivation(string Id, string State, string Progress, string? Error);

public sealed record JobState(string State, string? Error);

public sealed record JobOutput(List<string> Lines);

public sealed record Health(string Status, string Repo);

public sealed record ErrorDetail(string Detail);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.SnakeCaseLower)]
[JsonSerializable(typeof(NodeRef))]
[JsonSerializable(typeof(List<NodeRef>))]
[JsonSerializable(typeof(RootRef))]
[JsonSerializable(typeof(List<Connection>))]
[JsonSerializable(typeof(StructureResponse))]
[JsonSerializable(typeof(SourceFragment))]
[JsonSerializable(typeof(WorkspaceStatus))]
[JsonSerializable(typeof(WorkspaceActivation))]
[JsonSerializable(typeof(JobState))]
[JsonSerializable(typeof(JobOutput))]
[JsonSerializable(typeof(Health))]
[JsonSerializable(typeof(ErrorDetail))]
[JsonSerializable(typeof(JsonObject))]
public sealed partial class BridgeJson : JsonSerializerContext;
