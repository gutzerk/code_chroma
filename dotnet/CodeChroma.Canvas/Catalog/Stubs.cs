namespace CodeChroma.Canvas.Catalog;

public sealed record BuiltinRecipe(string Name, string Label, bool Generated);

public sealed record ReadyDiagrams(
    IReadOnlyList<BuiltinRecipe> ReadyBuiltins, IReadOnlyList<DiagramTypeSummary> ReadyCustomTypes,
    IReadOnlyList<string> MissingLabels, IReadOnlyList<string> AllLabels, bool AnyGeneratedReady);

public sealed record OpResult(bool Ok, string? Error = null);

public static class DiagramCatalog
{
    public static IReadOnlyList<string> WatchedDiagramEventKinds => throw new NotImplementedException();
    public static bool IsDiagramLayer(string layer) => throw new NotImplementedException();
    public static bool IsRecipeBackedLayer(string layer) => throw new NotImplementedException();
    public static bool HasDeletableDiagramArtifact(string layer) => throw new NotImplementedException();
    public static IReadOnlyList<string> ListActiveDiagramLayers(CanvasDoc doc) => throw new NotImplementedException();
    public static string LabelForDiagramLayer(string layer, IReadOnlyList<DiagramTypeSummary> customTypes, CanvasDoc? doc = null) => throw new NotImplementedException();
    public static ReadyDiagrams ComputeReadyDiagrams(DiagramsStatus? status, IReadOnlyList<DiagramTypeSummary> customTypes, ISet<string> activeLayers) => throw new NotImplementedException();
    public static string BuildDrawDiagramTask(IReadOnlyList<string> labels, bool anyAlreadyReady) => throw new NotImplementedException();
}

public sealed class DiagramOrchestrator
{
    public DiagramOrchestrator(ICanvasBridge bridge, CanvasDocStore store, LayerPositionCache cache, DiagramHealthStore health) => throw new NotImplementedException();
    public Task<OpResult> RunRecipeAndLayoutAsync(string name) => throw new NotImplementedException();
    public Task<OpResult> RemoveLayerAndRefreshAsync(string layer) => throw new NotImplementedException();
    public Task<OpResult> DeleteDiagramAndRefreshAsync(string layer) => throw new NotImplementedException();
}
