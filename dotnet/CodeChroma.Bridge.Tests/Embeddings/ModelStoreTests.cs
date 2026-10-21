using System.Net;
using System.Security.Cryptography;
using System.Text;
using CodeChroma.Bridge.Embeddings;

namespace CodeChroma.Bridge.Tests.Embeddings;

public class ModelStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"models-{Guid.NewGuid():N}");

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private sealed class Handler(Func<string, HttpResponseMessage> reply) : HttpMessageHandler
    {
        public List<string> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Requests.Add(request.RequestUri!.AbsolutePath);
            return Task.FromResult(reply(request.RequestUri.AbsolutePath));
        }
    }

    private static ModelFile Pinned(string name, string content) =>
        new(name, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content))).ToLowerInvariant(), 1000);

    private static HttpResponseMessage Ok(string content) => new(HttpStatusCode.OK) { Content = new StringContent(content) };

    [Fact]
    public async Task Missing_files_are_downloaded_verified_and_not_fetched_again()
    {
        var handler = new Handler(path => Ok(path.EndsWith("m.onnx") ? "weights" : "tokens"));
        var files = new[] { Pinned("m.onnx", "weights"), Pinned("t.json", "tokens") };
        var store = new ModelStore(_dir, new HttpClient(handler), "https://example.test/models/", files);

        await store.EnsureAsync();
        await store.EnsureAsync();

        Assert.Equal("weights", File.ReadAllText(Path.Combine(store.ModelDirectory, "m.onnx")));
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task A_hash_mismatch_is_refused_and_leaves_no_file()
    {
        var store = new ModelStore(_dir, new HttpClient(new Handler(_ => Ok("tampered"))), "https://example.test/models/", [Pinned("m.onnx", "weights")]);

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(() => store.EnsureAsync());

        Assert.Contains("SHA-256", failure.Message);
        Assert.Empty(Directory.GetFiles(store.ModelDirectory));
        Assert.False(store.IsInstalled());
    }

    [Fact]
    public async Task A_corrupt_local_file_is_replaced()
    {
        var store = new ModelStore(_dir, new HttpClient(new Handler(_ => Ok("weights"))), "https://example.test/models/", [Pinned("m.onnx", "weights")]);
        Directory.CreateDirectory(store.ModelDirectory);
        File.WriteAllText(Path.Combine(store.ModelDirectory, "m.onnx"), "rotten");

        await store.EnsureAsync();

        Assert.Equal("weights", File.ReadAllText(Path.Combine(store.ModelDirectory, "m.onnx")));
    }
}
