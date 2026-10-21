using CodeChroma.Bridge.Embeddings;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Context;

/// <summary>Gathers the architecture-map context for a diagram request, in-process, so a diagram agent starts from it instead of searching the repo.</summary>
public sealed class DiagramContext(ModelStore models)
{
    /// <summary>The diagram types that get gathered context; impact reads the diff and epics read requirements, so neither does.</summary>
    public static readonly IReadOnlySet<string> Types = new HashSet<string> { "c1", "patterns", "sequence", "custom" };

    /// <summary>The hint of a launch that has not asked the user what to draw yet; it gets the command but no fixed phrases.</summary>
    public const string AnyType = "any";

    private static readonly SemaphoreSlim BuildGate = new(1, 1);

    /// <summary>The phrases the selector scores the components against: fixed seeds for the whole-repo types, the user's request otherwise.</summary>
    public static IReadOnlyList<string> Phrases(string type, string? request)
    {
        var asked = string.IsNullOrWhiteSpace(request) ? null : request.Trim();
        return type switch
        {
            "c1" => ["system context users and external actors", "third-party services and API integrations", "database and storage", "entry points CLI web server"],
            "patterns" => ["design patterns", "factory builder strategy observer adapter decorator", "interfaces and abstract base classes", "registry and dependency injection"],
            _ when asked is not null => [asked],
            _ => ["main request flow and entry points"],
        };
    }

    /// <summary>The rendered context text, or null when it cannot be built (no architecture map, no graph, model unavailable); callers then fall back to the agent searching itself.</summary>
    public async Task<string?> GatherAsync(Workspace ws, string type, string? request, CancellationToken ct = default)
    {
        if (!Types.Contains(type)) return null;
        if (!models.IsInstalled())
        {
            _ = WarmModelAsync();
            return null;
        }
        if (!await PrepareAsync(ws, ct)) return null;
        try
        {
            var cache = new ContextCache(ws.Root);
            if (cache.Load() is not { } loaded) return null;
            var phrases = Phrases(type, request);
            using var embedder = new OnnxEmbedder(models.ModelPath, models.TokenizerPath);
            return ContextRenderer.Render(loaded.Data, ContextSelector.Select(loaded.Data, loaded.Titles, embedder.Embed(phrases)), phrases);
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or Microsoft.ML.OnnxRuntime.OnnxRuntimeException)
        {
            return null;
        }
    }

    /// <summary>The <c>context</c> command an interactive agent runs itself with phrases from the user's request; null (and a model download starts) when the map, graph or model is not ready.</summary>
    public async Task<string?> CommandAsync(Workspace ws, CancellationToken ct = default)
    {
        if (!models.IsInstalled())
        {
            _ = WarmModelAsync();
            return null;
        }
        return await PrepareAsync(ws, ct) ? ContextTool.CommandPrefix() + $" --repo-path \"{ws.Root}\" --models-dir \"{models.Directory}\"" : null;
    }

    /// <summary>Makes the model and the context cache ready (after a wiki-general run, and at startup); true when both are usable.</summary>
    public async Task<bool> PrepareAsync(Workspace ws, CancellationToken ct = default)
    {
        var cache = new ContextCache(ws.Root);
        if (!cache.HasWiki() || ws.Engine.GraphSnapshot() is not { } graph) return false;
        await BuildGate.WaitAsync(ct);
        try
        {
            await models.EnsureAsync(ct: ct);
            await Task.Run(() => cache.Ensure(graph, () => new OnnxEmbedder(models.ModelPath, models.TokenizerPath)), ct);
            return true;
        }
        catch (Exception error) when (error is HttpRequestException or IOException or InvalidOperationException or Microsoft.ML.OnnxRuntime.OnnxRuntimeException)
        {
            return false;
        }
        finally
        {
            BuildGate.Release();
        }
    }

    /// <summary>Downloads the model if missing; failures are swallowed because every use re-tries and falls back.</summary>
    public async Task WarmModelAsync(CancellationToken ct = default)
    {
        try { await models.EnsureAsync(ct: ct); }
        catch (Exception error) when (error is HttpRequestException or IOException or InvalidOperationException or OperationCanceledException) { }
    }
}
