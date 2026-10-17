namespace CodeChroma.Bridge.Epics;

/// <summary>The cheap listing entry; it never grows requirements, children or stages (lazy index).</summary>
public sealed record ItemRef(string Id, string Title, string Status, string Kind, string? Group = null);

/// <summary>A reference to another item, never resolved by fetching.</summary>
public sealed record ItemLink(string Id, string Relation, string? Title);

/// <summary>One acceptance criterion; Done null (no checkbox) and false are distinct states.</summary>
public sealed record Requirement(string Id, string Text, string Kind, string SourceRef, bool? Done = null);

public sealed record StageItem(string Id, string Text, bool? Done = null, string? Story = null, bool Parallel = false);

public sealed record StageSection(string Title, IReadOnlyList<StageItem> Items, int? Done = null, int? Total = null);

/// <summary>One delivery artifact (spec, plan, tasks, ...); sections stay empty until explicitly expanded.</summary>
public sealed record Stage(string Kind, string Name, string SourceRef, string? Status = null, int? Done = null, int? Total = null,
    IReadOnlyList<StageSection>? SectionList = null)
{
    public IReadOnlyList<StageSection> Sections => SectionList ?? [];
}

/// <summary>One recursive requirement holder: epic to story, initiative to epic to story to task.</summary>
public sealed record WorkItem(
    string Id, string Title, string Status, string Kind, string SourceRef,
    string Summary = "", string? Group = null, string? Priority = null, string? Url = null,
    IReadOnlyList<Requirement>? RequirementList = null, IReadOnlyList<WorkItem>? ChildList = null,
    IReadOnlyList<ItemLink>? LinkList = null, IReadOnlyList<Stage>? StageList = null,
    IReadOnlyList<string>? ReferenceList = null, string? ContextFile = null, string? Component = null)
{
    public IReadOnlyList<Requirement> Requirements => RequirementList ?? [];
    public IReadOnlyList<WorkItem> Children => ChildList ?? [];
    public IReadOnlyList<ItemLink> Links => LinkList ?? [];
    public IReadOnlyList<Stage> Stages => StageList ?? [];
    public IReadOnlyList<string> References => ReferenceList ?? [];
}

/// <summary>Where work items come from (a markdown directory, a tracker project).</summary>
public interface IRequirementsSource
{
    IReadOnlyList<ItemRef> ListItems();

    WorkItem? FetchItem(string itemId);
}

/// <summary>Where one work item's delivery artifacts live (spec files now, a PR later).</summary>
public interface IDeliverySource
{
    IReadOnlyList<Stage> StagesFor(string itemId, string? expand = null);
}
