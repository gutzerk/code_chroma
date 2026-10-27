using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Stores;

/// <summary>Asks an installed agent CLI for its own model list (claude control request, codex debug models); null when it can't answer.</summary>
public static class CliModelProbe
{
    private const int TimeoutSeconds = 20;
    private const string ClaudeRequestId = "models";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(2);
    private static readonly ConcurrentDictionary<string, (DateTime At, Task<JsonArray?> Models)> Cache = new();

    /// <summary>The executable and spawn environment the app itself would use for `adapter`; null when it is not installed (a null env inherits ours).</summary>
    public static (string Binary, IReadOnlyDictionary<string, string>? Env)? Locate(string adapter, RuntimeEnvironment? runtime)
    {
        if (runtime is null) return CliLocator.Find(adapter) is { } found ? (found, null) : null;
        try
        {
            var cli = runtime.Resolve(adapter);
            return (cli.Executable, cli.Env);
        }
        catch (CliLookupException)
        {
            return null;
        }
    }

    public static async Task<JsonArray?> Probe(string adapter, RuntimeEnvironment? runtime = null)
    {
        if (adapter is not ("claude" or "codex") || Locate(adapter, runtime) is not { } cli) return null;
        return await Cached($"{adapter}|{cli.Binary}", () => Run(adapter, cli.Binary, cli.Env));
    }

    /// <summary>Shares one probe per key for a couple of minutes; an unanswered probe (null) is dropped so the next call retries. Each caller gets its own copy, since a JsonNode has one parent.</summary>
    public static async Task<JsonArray?> Cached(string key, Func<Task<JsonArray?>> run)
    {
        var now = DateTime.UtcNow;
        if (!Cache.TryGetValue(key, out var entry) || now - entry.At >= CacheTtl)
        {
            entry = (now, run());
            Cache[key] = entry;
        }
        JsonArray? models;
        try
        {
            models = await entry.Models;
        }
        catch
        {
            Cache.TryRemove(KeyValuePair.Create(key, entry));
            throw;
        }
        if (models is null) Cache.TryRemove(KeyValuePair.Create(key, entry));
        return models?.DeepClone() as JsonArray;
    }

    private static async Task<JsonArray?> Run(string adapter, string binary, IReadOnlyDictionary<string, string>? env)
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(TimeoutSeconds));
            return adapter == "claude" ? await ProbeClaude(binary, env, timeout.Token) : await ProbeListing(binary, env, timeout.Token);
        }
        catch (Exception error) when (error is OperationCanceledException or IOException or InvalidOperationException
            or System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }

    private static async Task<JsonArray?> ProbeClaude(string binary, IReadOnlyDictionary<string, string>? env, CancellationToken cancel)
    {
        using var process = Start(binary, env, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose");
        try
        {
            var request = new JsonObject
            {
                ["type"] = "control_request", ["request_id"] = ClaudeRequestId,
                ["request"] = new JsonObject { ["subtype"] = "initialize" },
            };
            await process.StandardInput.WriteLineAsync(request.ToJsonString().AsMemory(), cancel);
            await process.StandardInput.FlushAsync(cancel);
            while (await process.StandardOutput.ReadLineAsync(cancel) is { } line)
                if (ParseClaudeResponse(line) is { } models) return models;
            return null;
        }
        finally
        {
            Kill(process);
        }
    }

    private static async Task<JsonArray?> ProbeListing(string binary, IReadOnlyDictionary<string, string>? env, CancellationToken cancel)
    {
        using var process = Start(binary, env, "debug", "models");
        try
        {
            var stdout = process.StandardOutput.ReadToEndAsync(cancel);
            await process.WaitForExitAsync(cancel);
            return process.ExitCode == 0 ? ParseModelList(await stdout) : null;
        }
        finally
        {
            Kill(process);
        }
    }

    private static Process Start(string binary, IReadOnlyDictionary<string, string>? env, params string[] args)
    {
        var info = new ProcessStartInfo(binary)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8,
        };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        if (env is not null)
        {
            info.Environment.Clear();
            foreach (var (name, value) in env) info.Environment[name] = value;
        }
        var process = Process.Start(info) ?? throw new InvalidOperationException("process did not start");
        process.ErrorDataReceived += (_, _) => { };
        process.BeginErrorReadLine();
        return process;
    }

    private static void Kill(Process process)
    {
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
    }

    /// <summary>The `{id, label}` list of a claude control_response line (`response.response.models[]`), else null.</summary>
    public static JsonArray? ParseClaudeResponse(string line)
    {
        JsonNode? root;
        try { root = JsonNode.Parse(line); }
        catch (System.Text.Json.JsonException) { return null; }
        if (Json.Str(root?["type"]) != "control_response" || Json.Str(root?["response"]?["request_id"]) != ClaudeRequestId) return null;
        return root?["response"]?["response"]?["models"] is JsonArray items ? Shape(items, "value", "displayName") : null;
    }

    /// <summary>The `{id, label}` list of a model-listing JSON document: a bare array, or one under models/data.</summary>
    public static JsonArray? ParseModelList(string text)
    {
        JsonNode? root;
        try { root = JsonNode.Parse(text); }
        catch (System.Text.Json.JsonException) { return null; }
        var items = root as JsonArray ?? (root as JsonObject is { } o ? o["models"] ?? o["data"] : null) as JsonArray;
        return items is null ? null : Shape(items, "slug", "display_name");
    }

    private static JsonArray? Shape(JsonArray items, string idKey, string labelKey)
    {
        var models = new JsonArray();
        foreach (var item in items)
        {
            if (item is not JsonObject o) continue;
            var id = Json.Str(o[idKey]) ?? Json.Str(o["id"]) ?? Json.Str(o["model"]) ?? Json.Str(o["name"]);
            if (string.IsNullOrEmpty(id)) continue;
            var label = Json.Str(o[labelKey]) ?? Json.Str(o["displayName"]) ?? Json.Str(o["display_name"]);
            models.Add(new JsonObject { ["id"] = id, ["label"] = label });
        }
        return models.Count == 0 ? null : models;
    }
}
