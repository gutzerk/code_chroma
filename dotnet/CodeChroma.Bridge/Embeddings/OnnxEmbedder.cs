using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace CodeChroma.Bridge.Embeddings;

/// <summary>Turns texts into unit vectors; the seam that lets the context selector run without the real model in tests.</summary>
public interface IEmbedder
{
    float[][] Embed(IReadOnlyList<string> texts);
}

/// <summary>jina-embeddings-v2-base-code on ONNX Runtime: mean pooling over the attention mask, then L2 normalization.</summary>
public sealed class OnnxEmbedder : IEmbedder, IDisposable
{
    private const int BatchSize = 16;
    private readonly InferenceSession _session;
    private readonly ByteLevelBpeTokenizer _tokenizer;
    private readonly bool _wantsTokenTypes;

    public OnnxEmbedder(string modelPath, string tokenizerPath)
    {
        _tokenizer = ByteLevelBpeTokenizer.Load(tokenizerPath);
        _session = new InferenceSession(modelPath);
        _wantsTokenTypes = _session.InputMetadata.ContainsKey("token_type_ids");
    }

    public float[][] Embed(IReadOnlyList<string> texts)
    {
        var result = new float[texts.Count][];
        for (var start = 0; start < texts.Count; start += BatchSize)
        {
            var batch = texts.Skip(start).Take(BatchSize).Select(_tokenizer.Encode).ToArray();
            var pooled = EmbedBatch(batch);
            for (var i = 0; i < pooled.Length; i++) result[start + i] = pooled[i];
        }
        return result;
    }

    private float[][] EmbedBatch(int[][] batch)
    {
        var width = batch.Max(ids => ids.Length);
        var ids = new DenseTensor<long>([batch.Length, width]);
        var mask = new DenseTensor<long>([batch.Length, width]);
        for (var row = 0; row < batch.Length; row++)
            for (var col = 0; col < width; col++)
            {
                var real = col < batch[row].Length;
                ids[row, col] = real ? batch[row][col] : _tokenizer.PadId;
                mask[row, col] = real ? 1 : 0;
            }
        var inputs = new List<NamedOnnxValue> { NamedOnnxValue.CreateFromTensor("input_ids", ids), NamedOnnxValue.CreateFromTensor("attention_mask", mask) };
        if (_wantsTokenTypes) inputs.Add(NamedOnnxValue.CreateFromTensor("token_type_ids", new DenseTensor<long>([batch.Length, width])));
        using var outputs = _session.Run(inputs);
        var hidden = outputs.First().AsTensor<float>();
        var dims = hidden.Dimensions.ToArray();
        return Enumerable.Range(0, batch.Length).Select(row => dims.Length == 3 ? MeanPool(hidden, row, batch[row].Length, dims[2]) : Normalize(Row(hidden, row, dims[1]))).ToArray();
    }

    private static float[] Row(Tensor<float> tensor, int row, int size) => Enumerable.Range(0, size).Select(c => tensor[row, c]).ToArray();

    private static float[] MeanPool(Tensor<float> hidden, int row, int realTokens, int size)
    {
        var sum = new float[size];
        for (var t = 0; t < realTokens; t++)
            for (var c = 0; c < size; c++) sum[c] += hidden[row, t, c];
        for (var c = 0; c < size; c++) sum[c] /= realTokens;
        return Normalize(sum);
    }

    private static float[] Normalize(float[] vector)
    {
        var norm = MathF.Sqrt(vector.Sum(v => v * v));
        return norm == 0 ? vector : vector.Select(v => v / norm).ToArray();
    }

    public void Dispose() => _session.Dispose();
}
