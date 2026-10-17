namespace CodeChroma.Canvas.Tests;

/// <summary>A scriptable ICanvasBridge: the jsdom/EngineClient mocks of the vitest suite as one plain fake.</summary>
internal sealed class FakeBridge : ICanvasBridge
{
    public List<CanvasBatch> Patches { get; } = new();
    public List<string> Calls { get; } = new();
    public Func<Task<CanvasDoc>> GetCanvas { get; set; } = () => Task.FromResult(CanvasDoc.Empty);
    public Func<string, Task<RecipeRunResult>> RunRecipe { get; set; } =
        _ => Task.FromResult(new RecipeRunResult(true, new Dictionary<string, string>(), Array.Empty<string>()));
    public Func<string, Task<bool>> DeleteDiagram { get; set; } = _ => Task.FromResult(true);
    public Func<CanvasBatch, Task<BatchResult>> Patch { get; set; } = _ => Task.FromResult(new BatchResult(true, Array.Empty<string>()));

    public Task<CanvasDoc> GetCanvasAsync() { Calls.Add("getCanvas"); return GetCanvas(); }
    public Task<RecipeRunResult> RunRecipeAsync(string name) { Calls.Add($"runRecipe:{name}"); return RunRecipe(name); }
    public Task<bool> DeleteDiagramAsync(string kind) { Calls.Add($"delete:{kind}"); return DeleteDiagram(kind); }
    public Task<BatchResult> PatchCanvasAsync(CanvasBatch batch) { Calls.Add("patch"); Patches.Add(batch); return Patch(batch); }
}
