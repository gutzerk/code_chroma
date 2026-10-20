using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using CodeChroma.Bridge.Embeddings;
using CodeChroma.Core;

namespace CodeChroma.Bridge.Context;

/// <summary>The cached context data of one repo: built from wiki-general + the graph, reused until either changes.</summary>
public sealed class ContextCache(string repoRoot)
{
    public string Directory { get; } = Path.Combine(repoRoot, ".codechroma", "context-cache");

    public string WikiDirectory { get; } = Skills.WikiGeneral.Dir(repoRoot);

    private string DataPath => Path.Combine(Directory, "data.json");

    private string EmbeddingsPath => Path.Combine(Directory, "title_emb.bin");

    private string FingerprintPath => Path.Combine(Directory, "fingerprint.txt");

    public bool HasWiki() => File.Exists(Path.Combine(WikiDirectory, "manifest.json"));

    /// <summary>Hash of the wiki manifest, the symbol count and the model name: any change rebuilds the cache.</summary>
    public string Fingerprint(Graph graph)
    {
        var manifest = File.ReadAllBytes(Path.Combine(WikiDirectory, "manifest.json"));
        var tail = System.Text.Encoding.UTF8.GetBytes($"|{graph.SymbolList.Count}|{EmbeddingModel.Name}|v{ContextCacheBuilder.Version}");
        return Convert.ToHexString(SHA256.HashData([.. manifest, .. tail]))[..16].ToLowerInvariant();
    }

    /// <summary>True when the stored data was built for <paramref name="fingerprint"/>; reads only the small sidecar, not the data.</summary>
    public bool IsFresh(string fingerprint)
    {
        try { return File.Exists(DataPath) && File.Exists(EmbeddingsPath) && File.ReadAllText(FingerprintPath).Trim() == fingerprint; }
        catch (IOException) { return false; }
    }

    public (ContextData Data, float[][] Titles)? Load()
    {
        try
        {
            if (!File.Exists(DataPath) || !File.Exists(EmbeddingsPath)) return null;
            var data = JsonSerializer.Deserialize<ContextData>(File.ReadAllText(DataPath));
            var raw = File.ReadAllBytes(EmbeddingsPath);
            if (data is null || data.Pages.Count == 0 || raw.Length % (data.Pages.Count * sizeof(float)) != 0) return null;
            var floats = new float[raw.Length / sizeof(float)];
            Buffer.BlockCopy(raw, 0, floats, 0, raw.Length);
            var size = floats.Length / data.Pages.Count;
            return (data, Enumerable.Range(0, data.Pages.Count).Select(i => floats[(i * size)..((i + 1) * size)]).ToArray());
        }
        catch (Exception error) when (error is IOException or JsonException)
        {
            return null;
        }
    }

    /// <summary>Builds and stores the data when stale; the embedder is only created (and disposed) when titles need embedding.</summary>
    public void Ensure(Graph graph, Func<IEmbedder> createEmbedder)
    {
        var fingerprint = Fingerprint(graph);
        if (IsFresh(fingerprint)) return;
        var data = ContextCacheBuilder.Build(WikiDirectory, graph, fingerprint);
        var embedder = createEmbedder();
        float[][] vectors;
        try { vectors = embedder.Embed([.. data.Pages.Select(p => p.Title)]); }
        finally { (embedder as IDisposable)?.Dispose(); }
        var size = vectors.Length == 0 ? 0 : vectors[0].Length;
        var raw = new byte[vectors.Length * size * sizeof(float)];
        for (var i = 0; i < vectors.Length; i++) Buffer.BlockCopy(vectors[i], 0, raw, i * size * sizeof(float), size * sizeof(float));
        System.IO.Directory.CreateDirectory(Directory);
        File.WriteAllBytes(EmbeddingsPath, raw);
        File.WriteAllText(DataPath, JsonSerializer.Serialize(data));
        File.WriteAllText(FingerprintPath, fingerprint);
    }
}

/// <summary>The `context` command the bare agent runs: phrases in, selected-components text out.</summary>
public static class ContextTool
{
    /// <summary>`bridge context --repo-path X [--models-dir D] "phrase" …`; stdout is the context, stderr the timing. Returns the process exit code.</summary>
    public static int Run(string[] args, TextWriter output, TextWriter error)
    {
        var watch = Stopwatch.StartNew();
        string? repo = null;
        string? modelsDir = null;
        var phrases = new List<string>();
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--repo-path" && i + 1 < args.Length) repo = args[++i];
            else if (args[i] == "--models-dir" && i + 1 < args.Length) modelsDir = args[++i];
            else phrases.Add(args[i]);
        }
        repo = Path.GetFullPath(repo ?? ".");
        if (phrases.Count == 0) return Fail(error, "usage: context [--repo-path X] \"phrase\" [\"phrase\" ...]");
        var cache = new ContextCache(repo);
        if (cache.Load() is not { } loaded) return Fail(error, "no context cache for this repo yet; generate the architecture map and let the bridge build it");
        var store = new ModelStore(modelsDir ?? ModelStore.DefaultDirectory(), new HttpClient());
        if (!store.IsInstalled()) return Fail(error, "the embedding model is not installed");
        using var embedder = new OnnxEmbedder(store.ModelPath, store.TokenizerPath);
        var selection = ContextSelector.Select(loaded.Data, loaded.Titles, embedder.Embed(phrases));
        output.Write(ContextRenderer.Render(loaded.Data, selection, phrases));
        error.WriteLine($"context: {watch.Elapsed.TotalSeconds:0.0}s");
        return 0;
    }

    private static int Fail(TextWriter error, string message)
    {
        error.WriteLine(message);
        return 2;
    }

    /// <summary>How the agent launches this process's `context` command: the exe itself, or `dotnet app.dll` in a dev run.</summary>
    public static string CommandPrefix()
    {
        var process = Environment.ProcessPath ?? "codechroma-bridge";
        var isHost = Path.GetFileNameWithoutExtension(process).Equals("dotnet", StringComparison.OrdinalIgnoreCase);
        var entry = System.Reflection.Assembly.GetEntryAssembly()?.Location;
        return isHost && entry is not null ? $"\"{process}\" \"{entry}\" context" : $"\"{process}\" context";
    }
}
