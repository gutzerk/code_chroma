using CodeChroma.Bridge.Embeddings;

namespace CodeChroma.Bridge.Tests.Embeddings;

public class EmbeddingsTests
{
    private static string? ModelDir => Environment.GetEnvironmentVariable("CODECHROMA_TEST_MODEL_DIR");

    private static string TinyTokenizer()
    {
        var path = Path.Combine(Path.GetTempPath(), $"tok-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, """
            {"model":{"type":"BPE","vocab":{"<s>":0,"<pad>":1,"</s>":2,"<unk>":3,"h":4,"i":5,"hi":6,"Ġ":7,"t":8,"Ġt":9},
             "merges":["h i","Ġ t"]}}
            """);
        return path;
    }

    [Fact]
    public void Tokenizer_wraps_text_in_markers_and_applies_merges()
    {
        var tokenizer = ByteLevelBpeTokenizer.Load(TinyTokenizer());

        var ids = tokenizer.Encode("hi t");

        Assert.Equal([0, 6, 9, 2], ids);
    }

    [Fact]
    public void Tokenizer_maps_unknown_pieces_to_unk()
    {
        var tokenizer = ByteLevelBpeTokenizer.Load(TinyTokenizer());

        var ids = tokenizer.Encode("z");

        Assert.Equal([0, 3, 2], ids);
    }

    [Fact]
    public void Tokenizer_truncates_to_the_token_limit()
    {
        var tokenizer = ByteLevelBpeTokenizer.Load(TinyTokenizer());

        var ids = tokenizer.Encode(string.Join(' ', Enumerable.Repeat("hi", 2000)));

        Assert.Equal(ByteLevelBpeTokenizer.MaxTokens, ids.Length);
        Assert.Equal(2, ids[^1]);
    }

    [Fact]
    public void The_real_model_ranks_related_text_above_unrelated_text()
    {
        if (ModelDir is null) return;
        using var embedder = new OnnxEmbedder(Path.Combine(ModelDir!, "model_quantized.onnx"), Path.Combine(ModelDir!, "tokenizer.json"));

        var v = embedder.Embed(["hardware fit", "Checks whether a model fits the GPU memory of the machine", "Renders the login form button styles"]);

        Assert.True(Dot(v[0], v[1]) > Dot(v[0], v[2]));
        Assert.InRange(Dot(v[0], v[0]), 0.99f, 1.01f);
    }

    private static float Dot(float[] a, float[] b) => a.Zip(b, (x, y) => x * y).Sum();
}
