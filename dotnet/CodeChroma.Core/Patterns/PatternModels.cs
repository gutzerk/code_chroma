namespace CodeChroma.Core.Patterns;

public enum PatternType { Strategy, Facade, Adapter, Registry, Singleton, Observer, Repository }

public enum PatternRole { Interface, Implementation, Dispatcher, Facade, Target, Adapter, Adaptee, Registry, Entry, Instance, Subject, Observer }

public enum PatternRelationKind { Implements, Uses, Wraps, Registers }

/// <summary>What one method does to its receiver's attributes; mirrors graph/models.py MethodShape.</summary>
public sealed class MethodShape
{
    public List<string> Decorators { get; init; } = [];
    public List<string> WritesDictAttrs { get; } = [];
    public List<string> ReadsDictAttrs { get; } = [];
    public List<string> AppendsListAttrs { get; } = [];
    public List<string> IteratesAttrs { get; } = [];
    public List<string> SetsClassAttr { get; } = [];
    public List<string> ChecksNoneClassAttr { get; } = [];
    public Dictionary<string, List<string>> CallsOnAttr { get; } = [];
}

/// <summary>Structural summary of one class/struct/interface; mirrors graph/models.py ClassShape.</summary>
public sealed class ClassShape(string symbolId)
{
    public string SymbolId { get; } = symbolId;
    public List<string> Bases { get; init; } = [];
    public List<string> Decorators { get; init; } = [];
    public bool IsAbstract { get; set; }
    public Dictionary<string, MethodShape> Methods { get; } = [];
    public Dictionary<string, string> ClassAttrs { get; } = [];

    /// <summary>"class" (Python) | "struct" | "interface" | "type" (Go).</summary>
    public string Kind { get; set; } = "class";
}

public sealed record PatternParticipant(
    string Id, PatternRole Role, string Name, string QualifiedName, string? NodeId = null, string? Path = null,
    string? Description = null);

public sealed record PatternRelation(string FromId, string ToId, PatternRelationKind Kind, string? Label = null);

public sealed record PatternInstance(
    string Id, PatternType Type, string Name, double? Confidence, IReadOnlyList<PatternParticipant> Participants,
    IReadOnlyList<PatternRelation> Relations, string? Description = null, bool? Confirmed = null);
