using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Stores;

/// <summary>A provider's own model list, queried live (never raises); mirrors llm/model_catalog.py.</summary>
public static class ModelCatalog
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };

    public static Task<JsonObject> Fetch(JsonObject provider) => Fetch(provider, Http);

    public static async Task<JsonObject> Fetch(JsonObject provider, HttpClient http)
    {
        var kind = Json.Str(provider["kind"]);
        var transport = Json.Str(provider["transport"]);
        var baseUrl = Json.Str(provider["base_url"]);
        var key = ResolveKey(provider);
        if (kind == "api" && transport == "openai-compatible")
        {
            if (string.IsNullOrEmpty(baseUrl)) return Unsupported();
            var headers = key is null ? [] : new Dictionary<string, string> { ["Authorization"] = $"Bearer {key}" };
            return await Shape(http, $"{baseUrl.TrimEnd('/')}/models", headers, "data", item => Str(item, "id"), _ => null);
        }
        if (kind == "api" && transport == "anthropic")
            return key is null ? Unsupported() : await Anthropic(http, baseUrl ?? "https://api.anthropic.com", key);
        if (kind == "api" && transport == "gemini")
        {
            if (key is null) return Unsupported();
            var url = $"{(baseUrl ?? "https://generativelanguage.googleapis.com").TrimEnd('/')}/v1beta/models";
            return await Shape(http, url, new Dictionary<string, string> { ["x-goog-api-key"] = key }, "models",
                item => Str(item, "name") is { } n && n.StartsWith("models/", StringComparison.Ordinal) ? n["models/".Length..] : null,
                item => Str(item, "displayName"));
        }
        if (kind == "cli" && Json.Str(provider["adapter"]) == "claude" && !string.IsNullOrEmpty(baseUrl))
            return await Anthropic(http, baseUrl, key);
        return Unsupported();
    }

    private static Task<JsonObject> Anthropic(HttpClient http, string baseUrl, string? key)
    {
        var headers = new Dictionary<string, string> { ["anthropic-version"] = "2023-06-01" };
        if (key is not null) headers["x-api-key"] = key;
        return Shape(http, $"{baseUrl.TrimEnd('/')}/v1/models", headers, "data", item => Str(item, "id"), item => Str(item, "display_name"));
    }

    private static async Task<JsonObject> Shape(HttpClient http, string url, Dictionary<string, string> headers, string listKey,
        Func<JsonObject, string?> id, Func<JsonObject, string?> label)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            foreach (var (name, value) in headers) request.Headers.TryAddWithoutValidation(name, value);
            using var response = await http.SendAsync(request);
            response.EnsureSuccessStatusCode();
            var data = JsonNode.Parse(await response.Content.ReadAsStringAsync()) as JsonObject;
            var models = new JsonArray();
            foreach (var item in (data?[listKey] as JsonArray) ?? [])
                if (item is JsonObject o && id(o) is { } modelId)
                    models.Add(new JsonObject { ["id"] = modelId, ["label"] = label(o) });
            return new JsonObject { ["supported"] = true, ["models"] = models, ["error"] = null };
        }
        catch (Exception error)
        {
            return new JsonObject { ["supported"] = true, ["models"] = new JsonArray(), ["error"] = error.Message };
        }
    }

    private static string? Str(JsonObject item, string key) => Json.Str(item[key]);

    private static JsonObject Unsupported() => new() { ["supported"] = false, ["models"] = new JsonArray(), ["error"] = null };

    /// <summary>The provider's key: the stored one, else the first non-comment line of its key file.</summary>
    public static string? ResolveKey(JsonObject provider)
    {
        if (Json.Str(provider["api_key"]) is { Length: > 0 } key) return key;
        if (Json.Str(provider["api_key_path"]) is not { Length: > 0 } path) return null;
        try
        {
            var expanded = path.StartsWith('~') ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + path[1..] : path;
            return File.ReadLines(expanded).Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0 && !l.StartsWith('#'));
        }
        catch (IOException)
        {
            return null;
        }
    }
}

/// <summary>The provider "Test" button; only the CLI half is ported, API completions are reported as unavailable.</summary>
public static class ProviderTester
{
    public static async Task<JsonObject> Run(string? providerId, JsonObject provider)
    {
        if (Json.Str(provider["kind"]) == "cli")
        {
            var adapter = Json.Str(provider["adapter"]) ?? "";
            if (CliLocator.Find(adapter) is null)
                return Failure(providerId, $"{adapter} was not found on PATH");
            var models = await ModelCatalog.Fetch(provider);
            return models["error"] is { } error
                ? Failure(providerId, error.ToString())
                : new JsonObject { ["ok"] = true, ["provider_id"] = providerId, ["message"] = "ok" };
        }
        return Failure(providerId, "API provider completion tests are not available in the C# bridge yet");
    }

    private static JsonObject Failure(string? providerId, string error) =>
        new() { ["ok"] = false, ["provider_id"] = providerId, ["error"] = error };
}
