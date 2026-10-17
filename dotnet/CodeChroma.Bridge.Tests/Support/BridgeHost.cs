using System.Diagnostics;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Stores;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using CodeChroma.Bridge.Tests.Contract;

namespace CodeChroma.Bridge.Tests.Support;

/// <summary>A bridge over a throwaway git copy of tests/fixtures/sample_repo, served in-memory.</summary>
public sealed class BridgeHost : IDisposable
{
    public string Root { get; }
    public WebApplicationFactory<Program> Factory { get; }
    public HttpClient Client { get; }
    public TestServer Server => Factory.Server;

    private readonly string _tempDir;

    public BridgeHost(System.Text.Json.Nodes.JsonObject? repoSpec = null, Action<IServiceCollection>? configure = null)
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "cc-bridge-" + Guid.NewGuid().ToString("N")[..8]);
        Root = Path.Combine(_tempDir, "repo");
        CopyDir(Path.Combine(ContractCases.FixtureDir, "..", "sample_repo"), Root);
        foreach (var file in repoSpec?["files"]?.AsObject() ?? [])
        {
            var target = Path.Combine(Root, file.Key);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            var spec = file.Value!.AsObject();
            File.WriteAllBytes(target, spec["base64"] is { } b64
                ? Convert.FromBase64String(b64.GetValue<string>())
                : System.Text.Encoding.UTF8.GetBytes(spec["text"]!.GetValue<string>()));
        }
        InitGit(Root);
        var snapshot = Path.Combine(ContractCases.FixtureDir, "engine_snapshot.sample_repo.json");
        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Bridge:RepoRoot", Root);
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<IEngineFactory>(new SnapshotEngineFactory(snapshot));
                services.AddSingleton(UserPaths.Under(Path.Combine(_tempDir, "user-stores")));
                configure?.Invoke(services);
            });
        });
        Client = Factory.CreateClient();
    }

    private static void CopyDir(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.GetFiles(from)) File.Copy(file, Path.Combine(to, Path.GetFileName(file)));
        foreach (var dir in Directory.GetDirectories(from)) CopyDir(dir, Path.Combine(to, Path.GetFileName(dir)));
    }

    private static void InitGit(string root)
    {
        foreach (var args in new[]
        {
            "init", "config user.email test@example.com", "config user.name Test", "config core.autocrlf false",
            "add -A", "commit -m initial",
        })
        {
            var info = new ProcessStartInfo("git", args) { WorkingDirectory = root, RedirectStandardOutput = true, RedirectStandardError = true };
            using var process = Process.Start(info)!;
            process.WaitForExit();
            if (process.ExitCode != 0) throw new InvalidOperationException($"git {args}: {process.StandardError.ReadToEnd()}");
        }
    }

    public void Dispose()
    {
        Client.Dispose();
        Factory.Dispose();
        try { ForceDelete(_tempDir); } catch (IOException) { }
    }

    private static void ForceDelete(string dir)
    {
        if (!Directory.Exists(dir)) return;
        foreach (var file in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            File.SetAttributes(file, FileAttributes.Normal);
        Directory.Delete(dir, recursive: true);
    }
}
