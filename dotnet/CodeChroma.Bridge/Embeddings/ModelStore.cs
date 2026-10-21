using System.Security.Cryptography;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Embeddings;

/// <summary>One pinned model file: where it lands, its expected SHA-256 and its upper size bound.</summary>
public sealed record ModelFile(string Name, string Sha256, long MaxBytes);

/// <summary>The embedding model's release asset files; `.github/workflows/publish-model.yml` uploads exactly these.</summary>
public static class EmbeddingModel
{
    public const string Name = "jina-embeddings-v2-base-code-int8";
    public const string ReleaseBase = "https://github.com/gutzerk/code_chroma/releases/download/models-v1/";
    public const string ModelFileName = "model_quantized.onnx";
    public const string TokenizerFileName = "tokenizer.json";

    public static IReadOnlyList<ModelFile> Files { get; } =
    [
        new(ModelFileName, "ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d", 200_000_000),
        new(TokenizerFileName, "b01c78a902aa4facb2f47f95449f48e2f7bbfea5d2472ee2f6ce92323c6f86e5", 10_000_000),
    ];
}

/// <summary>Finds the model under ~/.codechroma/models and downloads it once, verified against the pinned SHA-256.</summary>
public sealed class ModelStore(string directory, HttpClient http, string baseUrl = EmbeddingModel.ReleaseBase, IReadOnlyList<ModelFile>? files = null)
{
    public static string DefaultDirectory() => UserPaths.Resolve("codechroma_MODELS_DIR", "models");

    private readonly IReadOnlyList<ModelFile> _files = files ?? EmbeddingModel.Files;
    private readonly HashSet<string> _verified = [];

    public string Directory { get; } = directory;

    public string ModelDirectory { get; } = Path.Combine(directory, EmbeddingModel.Name);

    public string ModelPath => Path.Combine(ModelDirectory, EmbeddingModel.ModelFileName);

    public string TokenizerPath => Path.Combine(ModelDirectory, EmbeddingModel.TokenizerFileName);

    public bool IsInstalled() => _files.All(f => File.Exists(Path.Combine(ModelDirectory, f.Name)));

    /// <summary>Downloads whatever is missing or corrupt (each file is hashed once per process); a failure leaves no partial file behind.</summary>
    public async Task EnsureAsync(IProgress<(string File, long Bytes)>? progress = null, CancellationToken ct = default)
    {
        System.IO.Directory.CreateDirectory(ModelDirectory);
        foreach (var file in _files)
        {
            var target = Path.Combine(ModelDirectory, file.Name);
            if (_verified.Contains(target)) continue;
            if (!File.Exists(target) || await HashOf(target, ct) != file.Sha256) await Fetch(file, target, progress, ct);
            _verified.Add(target);
        }
    }

    private async Task Fetch(ModelFile file, string target, IProgress<(string File, long Bytes)>? progress, CancellationToken ct)
    {
        var part = target + ".part";
        try
        {
            using var response = await http.GetAsync(baseUrl + file.Name, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"model download failed for {file.Name} ({(int)response.StatusCode})");
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using (var body = await response.Content.ReadAsStreamAsync(ct))
            await using (var output = File.Create(part))
            {
                var buffer = new byte[81920];
                long total = 0;
                int read;
                while ((read = await body.ReadAsync(buffer, ct)) > 0)
                {
                    total += read;
                    if (total > file.MaxBytes) throw new InvalidOperationException($"{file.Name} is larger than expected; refusing it");
                    hash.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer.AsMemory(0, read), ct);
                    progress?.Report((file.Name, total));
                }
            }
            if (!string.Equals(Convert.ToHexString(hash.GetHashAndReset()), file.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"{file.Name} failed its SHA-256 check");
            File.Move(part, target, overwrite: true);
        }
        finally
        {
            File.Delete(part);
        }
    }

    private static async Task<string> HashOf(string path, CancellationToken ct)
    {
        await using var stream = File.OpenRead(path);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, ct)).ToLowerInvariant();
    }
}
