using System.Net.Http.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Skills;

/// <summary>One direct-API completion call, whichever transport the provider speaks.</summary>
public interface ILlmCompletion
{
    Task<string> Complete(string user, string model, int maxTokens, string? system = null);
}

public static class LlmCompletion
{
    public const string ProbeModel = "claude-3-5-haiku-latest";
    public const string GeminiProbeModel = "gemini-2.5-flash";
    public const string GeminiDefaultBaseUrl = "https://generativelanguage.googleapis.com";
    public const string AnthropicDefaultBaseUrl = "https://api.anthropic.com";

    public static HttpClient SharedHttp { get; } = new() { Timeout = TimeSpan.FromSeconds(60) };

    public static string? ProbeModelFor(string? transport) => transport switch
    {
        "anthropic" => ProbeModel,
        "gemini" => GeminiProbeModel,
        _ => null,
    };

    /// <summary>The client for a stored api-kind provider; null when it is misconfigured.</summary>
    public static ILlmCompletion? For(JsonObject provider, HttpClient http)
    {
        if (Json.Str(provider["kind"]) != "api") return null;
        var key = ProviderKeys.Resolve(provider);
        var baseUrl = Json.Str(provider["base_url"]);
        switch (Json.Str(provider["transport"]))
        {
            case "openai-compatible":
                return string.IsNullOrEmpty(baseUrl) ? null : new OpenAiCompatible(http, baseUrl, key);
            case "gemini":
                return key is null ? null : new Gemini(http, string.IsNullOrEmpty(baseUrl) ? GeminiDefaultBaseUrl : baseUrl, key);
            default:
                return key is null ? null : new Anthropic(http, string.IsNullOrEmpty(baseUrl) ? AnthropicBase() : baseUrl, key);
        }
    }

    /// <summary>The assistant settings' Anthropic client (settings key, key file, else env), or null without a key.</summary>
    public static ILlmCompletion? ForAssistant(string? apiKey, string? apiKeyPath, HttpClient http)
    {
        var key = !string.IsNullOrEmpty(apiKey) || !string.IsNullOrEmpty(apiKeyPath)
            ? ProviderKeys.From(apiKey, apiKeyPath)
            : Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
        return string.IsNullOrEmpty(key) ? null : new Anthropic(http, AnthropicBase(), key);
    }

    private static string AnthropicBase() =>
        Environment.GetEnvironmentVariable("ANTHROPIC_BASE_URL") is { Length: > 0 } env ? env : AnthropicDefaultBaseUrl;

    private static async Task<JsonNode?> Post(HttpClient http, string url, JsonObject body, Dictionary<string, string> headers)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        foreach (var (k, v) in headers) request.Headers.TryAddWithoutValidation(k, v);
        using var response = await http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return JsonNode.Parse(await response.Content.ReadAsStringAsync());
    }

    private static string Text(string? text, JsonNode? data) =>
        !string.IsNullOrWhiteSpace(text) ? text.Trim() : throw new InvalidOperationException($"empty or malformed completion response: {data?.ToJsonString()}");

    private sealed class Anthropic(HttpClient http, string baseUrl, string key) : ILlmCompletion
    {
        public async Task<string> Complete(string user, string model, int maxTokens, string? system = null)
        {
            var body = new JsonObject { ["model"] = model, ["max_tokens"] = maxTokens, ["messages"] = new JsonArray(new JsonObject { ["role"] = "user", ["content"] = user }) };
            if (system is not null) body["system"] = system;
            var data = await Post(http, $"{baseUrl.TrimEnd('/')}/v1/messages", body,
                new() { ["x-api-key"] = key, ["anthropic-version"] = "2023-06-01" });
            return Text(((data?["content"] as JsonArray)?.FirstOrDefault() as JsonObject)?["text"]?.GetValue<string>(), data);
        }
    }

    private sealed class OpenAiCompatible(HttpClient http, string baseUrl, string? key) : ILlmCompletion
    {
        public async Task<string> Complete(string user, string model, int maxTokens, string? system = null)
        {
            var messages = new JsonArray();
            if (system is not null) messages.Add(new JsonObject { ["role"] = "system", ["content"] = system });
            messages.Add(new JsonObject { ["role"] = "user", ["content"] = user });
            var headers = key is null ? [] : new Dictionary<string, string> { ["Authorization"] = $"Bearer {key}" };
            var data = await Post(http, $"{baseUrl.TrimEnd('/')}/chat/completions",
                new JsonObject { ["model"] = model, ["messages"] = messages, ["max_tokens"] = maxTokens }, headers);
            return Text((((data?["choices"] as JsonArray)?.FirstOrDefault() as JsonObject)?["message"] as JsonObject)?["content"]?.GetValue<string>(), data);
        }
    }

    private sealed class Gemini(HttpClient http, string baseUrl, string key) : ILlmCompletion
    {
        public async Task<string> Complete(string user, string model, int maxTokens, string? system = null)
        {
            var body = new JsonObject
            {
                ["contents"] = new JsonArray(new JsonObject { ["role"] = "user", ["parts"] = new JsonArray(new JsonObject { ["text"] = user }) }),
                ["generationConfig"] = new JsonObject { ["maxOutputTokens"] = maxTokens },
            };
            if (system is not null) body["systemInstruction"] = new JsonObject { ["parts"] = new JsonArray(new JsonObject { ["text"] = system }) };
            var data = await Post(http, $"{baseUrl.TrimEnd('/')}/v1beta/models/{model}:generateContent", body, new() { ["x-goog-api-key"] = key });
            var parts = (((data?["candidates"] as JsonArray)?.FirstOrDefault() as JsonObject)?["content"] as JsonObject)?["parts"] as JsonArray;
            return Text((parts?.FirstOrDefault() as JsonObject)?["text"]?.GetValue<string>(), data);
        }
    }
}
