using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Embeddings;
using CodeChroma.Bridge.Engine;
using CodeChroma.Core;

namespace CodeChroma.Bridge.Tests.Context;

public class ContextTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"ctx-{Guid.NewGuid():N}");

    public ContextTests()
    {
        var wiki = Path.Combine(_root, ".codechroma", "wiki-general");
        Directory.CreateDirectory(Path.Combine(wiki, "c2"));
        Directory.CreateDirectory(Path.Combine(wiki, "c3"));
        File.WriteAllText(Path.Combine(wiki, "manifest.json"), """
            {"containers":[{"id":"app","name":"App","path":"c2/app.md"}],
             "components":[{"id":"auth","name":"Auth","container":"app","path":"c3/auth.md","files":["svc/auth.go","svc/auth_test.go","svc/doc.go"]},
                           {"id":"store","name":"Store","container":"app","path":"c3/store.md","files":["svc/store.go"]},
                           {"id":"ui","name":"Ui","container":"app","path":"c3/ui.md","files":["web/ui.ts"]}],
             "edges":[{"from":"auth","to":"store","count":3},{"from":"ui","to":"store","count":1}]}
            """);
        File.WriteAllText(Path.Combine(wiki, "c2", "app.md"), "# The app container.\n\nIt holds everything.\n");
        File.WriteAllText(Path.Combine(wiki, "c3", "auth.md"), "# Checks bearer keys.\n\nAuth rejects bad keys.\n\n## Elements\n\n" +
            "- **Authorize** — check.\n  - File: `svc/auth.go`\n  - Function: `svc/auth.go::Authorize`\n- **Key** — type.\n  - Class: `svc/auth.go::Key`\n" +
            "- **TestAuthorize** — t.\n  - Function: `svc/auth_test.go::TestAuthorize`\n");
        File.WriteAllText(Path.Combine(wiki, "c3", "store.md"), "# Persists keys.\n\nStore saves.\n\n## Elements\n\n- **Load** — load.\n  - Function: `svc/store.go::Load`\n");
        File.WriteAllText(Path.Combine(wiki, "c3", "ui.md"), "# Draws the login form.\n\nUi renders.\n");
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private static Symbol Fn(string file, string name, params string[] refs) => new()
    {
        Id = $"{file}::function::{name}", FilePath = file, Kind = SymbolKind.Function, Name = name, QualifiedName = name, StartLine = 3, EndLine = 9, References = refs,
    };

    private static Graph TinyGraph() => new([], [
        Fn("svc/auth.go", "Authorize", "Load", "Authorize", "Load", "Error401", "fmt"),
        new Symbol { Id = "svc/auth.go::class::Key", FilePath = "svc/auth.go", Kind = SymbolKind.Class, Name = "Key", QualifiedName = "Key" },
        Fn("svc/auth_test.go", "TestAuthorize", "Authorize"),
        Fn("svc/store.go", "Load"),
    ]);

    /// <summary>Maps each text to a one-hot axis chosen by keyword so cosine similarity is predictable.</summary>
    private sealed class KeywordEmbedder : IEmbedder
    {
        private static readonly string[] Axes = ["bearer", "keys", "login"];

        public float[][] Embed(IReadOnlyList<string> texts) =>
            [.. texts.Select(t => Axes.Select(a => t.Contains(a, StringComparison.OrdinalIgnoreCase) ? 1f : 0f).Append(0.01f).ToArray())];
    }

    [Fact]
    public void Builder_resolves_symbols_filters_calls_and_drops_test_files()
    {
        var data = ContextCacheBuilder.Build(Path.Combine(_root, ".codechroma", "wiki-general"), TinyGraph(), "fp");

        var auth = data.Pages.Single(p => p.Id == "auth");
        var file = Assert.Single(auth.Files);
        Assert.Equal("svc/auth.go", file.Path);
        var authorize = file.Symbols.Single(s => s.Name == "Authorize");
        Assert.Equal(["Load", "Error401"], authorize.Calls);
        Assert.Contains(file.Symbols, s => s.IsClass && s.NodeId == "svc/auth.go::class::Key");
        Assert.Equal(["svc/doc.go"], auth.OtherFiles);
    }

    [Fact]
    public void Selector_ranks_the_matching_title_first_and_adds_heavy_neighbours()
    {
        var data = ContextCacheBuilder.Build(Path.Combine(_root, ".codechroma", "wiki-general"), TinyGraph(), "fp");
        var embedder = new KeywordEmbedder();
        var titles = embedder.Embed([.. data.Pages.Select(p => p.Title)]);

        var selection = ContextSelector.Select(data, titles, embedder.Embed(["bearer"]));

        Assert.Equal("auth", selection.Seeds[0].Id);
        Assert.Empty(selection.Neighbours);
    }

    [Fact]
    public void Renderer_prints_full_node_ids_with_call_order_and_links()
    {
        var data = ContextCacheBuilder.Build(Path.Combine(_root, ".codechroma", "wiki-general"), TinyGraph(), "fp");
        var selection = new Selection([data.Pages[0], data.Pages[1]], [data.Pages[2]]);

        var text = ContextRenderer.Render(data, selection, ["bearer"]);

        Assert.Contains("svc/auth.go::function::Authorize L3-9 > Load > Error401", text);
        Assert.Contains("also: Key (class)", text);
        Assert.Contains("auth>store 3", text);
        Assert.Contains("(+1 more files: doc.go)", text);
    }

    [Fact]
    public void Cache_is_reused_until_the_manifest_changes()
    {
        var cache = new ContextCache(_root);
        cache.Ensure(TinyGraph(), () => new KeywordEmbedder());
        var fresh = cache.IsFresh(cache.Fingerprint(TinyGraph()));

        File.AppendAllText(Path.Combine(cache.WikiDirectory, "manifest.json"), " ");

        Assert.True(fresh);
        Assert.False(cache.IsFresh(cache.Fingerprint(TinyGraph())));
    }

    [Fact]
    public void Real_model_finds_the_agents_component_in_this_repo()
    {
        var modelDir = Environment.GetEnvironmentVariable("CODECHROMA_TEST_MODEL_DIR");
        var repo = Environment.GetEnvironmentVariable("CODECHROMA_TEST_REPO");
        if (modelDir is null || repo is null) return;
        using var embedder = new OnnxEmbedder(Path.Combine(modelDir, "model_quantized.onnx"), Path.Combine(modelDir, "tokenizer.json"));
        var graph = new CoreGraphEngine(repo, new NativeAnalysisExporter()).GraphSnapshot()!;
        var cache = new ContextCache(repo);

        cache.Ensure(graph, () => new OnnxEmbedder(Path.Combine(modelDir, "model_quantized.onnx"), Path.Combine(modelDir, "tokenizer.json")));
        var (data, titles) = cache.Load()!.Value;
        var selection = ContextSelector.Select(data, titles, embedder.Embed(["agent worktree", "pull request handoff"]));
        var text = ContextRenderer.Render(data, selection, ["agent worktree", "pull request handoff"]);

        File.WriteAllText(Path.Combine(Path.GetTempPath(), "codechroma-context-sample.txt"), text);
        Assert.Contains(selection.Seeds, p => p.Id.StartsWith("agents"));
        Assert.True(text.Length <= 30_000, $"context is {text.Length} chars");
    }
}
