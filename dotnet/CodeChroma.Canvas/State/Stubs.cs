namespace CodeChroma.Canvas.State;

public interface IKeyValueStore
{
    string? Get(string key);
    void Set(string key, string value);
}

public sealed record BatchResult(bool Ok, IReadOnlyList<string> ErrorMessages);

public sealed record RecipeRunResult(bool Ok, IReadOnlyDictionary<string, string> IdMap, IReadOnlyList<string> Errors);

public interface ICanvasBridge
{
    Task<CanvasDoc> GetCanvasAsync();
    Task<BatchResult> PatchCanvasAsync(CanvasBatch batch);
    Task<RecipeRunResult> RunRecipeAsync(string name);
    Task<bool> DeleteDiagramAsync(string kind);
}

public sealed class WorkspaceStoreRegistry
{
    public void ResetAll() => throw new NotImplementedException();
}

public sealed class CanvasDocStore
{
    public event Action? Changed;
    public CanvasDoc Doc => throw new NotImplementedException();
    public bool Loaded => throw new NotImplementedException();
    public ISet<string> UnlayoutableLayers => throw new NotImplementedException();
    public ISet<string> AutoPlacedIds => throw new NotImplementedException();
    public void SetDoc(CanvasDoc doc) => throw new NotImplementedException();
    public void DeferLayout(string layer) => throw new NotImplementedException();
    public void ReleaseLayout(string layer) => throw new NotImplementedException();
    public IReadOnlyList<string> LayersMidLayout() => throw new NotImplementedException();
    public void MoveElements(IReadOnlyDictionary<string, Position> positions) => throw new NotImplementedException();
    public Task FetchAndApplyAsync(ICanvasBridge bridge, Func<bool>? isStale = null) => throw new NotImplementedException();
    public Task<BatchResult> PatchAsync(ICanvasBridge bridge, IReadOnlyList<CanvasOp> ops, PatchOptions? options = null) => throw new NotImplementedException();
    public Task ApplyCanvasPositionsAsync(ICanvasBridge bridge, IReadOnlyDictionary<string, Position> positions) => throw new NotImplementedException();
}

public sealed record PatchOptions(string? Layer = null, string? Explanation = null, bool ConfirmMassDelete = false);

public sealed class CollapsedLayersStore
{
    public CollapsedLayersStore(IKeyValueStore storage, Func<string> activeWorkspace, WorkspaceStoreRegistry registry) => throw new NotImplementedException();
    public event Action? Changed;
    public IReadOnlyCollection<string> Collapsed => throw new NotImplementedException();
    public bool IsCollapsed(string layer) => throw new NotImplementedException();
    public void Collapse(string layer) => throw new NotImplementedException();
    public void Expand(string layer) => throw new NotImplementedException();
    public void Toggle(string layer) => throw new NotImplementedException();
    public void Load() => throw new NotImplementedException();
    public void Reset() => throw new NotImplementedException();
}

public readonly record struct LiveDragOffset(double X, double Y);

public sealed class DragOffsetStore
{
    public event Action? Changed;
    public IReadOnlyDictionary<string, LiveDragOffset> All => throw new NotImplementedException();
    public void Set(string id, LiveDragOffset offset) => throw new NotImplementedException();
    public void SetMany(IReadOnlyDictionary<string, LiveDragOffset> entries) => throw new NotImplementedException();
    public void Clear(string id) => throw new NotImplementedException();
    public void Reset() => throw new NotImplementedException();
}

public sealed class LayerPositionCache
{
    public void Capture(IReadOnlyCollection<CanvasElement> layerElements, string layer) => throw new NotImplementedException();
    public void Seed(string layer, IReadOnlyDictionary<string, Position> positions) => throw new NotImplementedException();
    public Position? Take(string layer, string recipeKey) => throw new NotImplementedException();
}

public sealed class DiagramStatusCache
{
    public DiagramStatusCache(IKeyValueStore storage) => throw new NotImplementedException();
    public DiagramsStatus? Read() => throw new NotImplementedException();
    public void Write(DiagramsStatus status) => throw new NotImplementedException();
}

public sealed record DiagramStatusPlan(IReadOnlyList<string> Arrived, IReadOnlyList<string> Stale);

public static class DiagramStatusPlanner
{
    public static DiagramStatusPlan Plan(DiagramsStatus? before, DiagramsStatus next, ISet<string> placed) => throw new NotImplementedException();
}

public sealed class DiagramHealthStore
{
    public void Set(string layer, IReadOnlyList<string> notes) => throw new NotImplementedException();
    public IReadOnlyList<string> Get(string layer) => throw new NotImplementedException();
    public void Clear(string layer) => throw new NotImplementedException();
}
