using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Tests.Skills;

public sealed class LlmCompletionTests
{
    private sealed class Stub(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private static JsonObject Provider(string transport, string? baseUrl = null, string? key = "k") => new()
    {
        ["id"] = "p", ["kind"] = "api", ["transport"] = transport, ["base_url"] = baseUrl, ["api_key"] = key, ["verify_ssl"] = true,
    };

    [Fact]
    public async Task Anthropic_posts_a_message_and_unwraps_the_first_text_block()
    {
        var stub = new Stub(HttpStatusCode.OK, """{"content":[{"type":"text","text":" ok \n"}]}""");

        var text = await LlmCompletion.For(Provider("anthropic", "https://api.test"), new HttpClient(stub))!.Complete("hi", "m", 1);

        Assert.Equal("ok", text);
        Assert.Equal("https://api.test/v1/messages", stub.Request!.RequestUri!.ToString());
        Assert.Equal("k", stub.Request.Headers.GetValues("x-api-key").Single());
        Assert.Equal(1, JsonNode.Parse(stub.Body!)!["max_tokens"]!.GetValue<int>());
    }

    [Fact]
    public async Task OpenAI_compatible_uses_a_bearer_token_and_chat_completions()
    {
        var stub = new Stub(HttpStatusCode.OK, """{"choices":[{"message":{"content":"ok"}}]}""");

        var text = await LlmCompletion.For(Provider("openai-compatible", "http://local/v1/"), new HttpClient(stub))!.Complete("hi", "m", 1, "sys");

        Assert.Equal("ok", text);
        Assert.Equal("http://local/v1/chat/completions", stub.Request!.RequestUri!.ToString());
        Assert.Equal("Bearer k", stub.Request.Headers.Authorization!.ToString());
        Assert.Equal("system", JsonNode.Parse(stub.Body!)!["messages"]![0]!["role"]!.GetValue<string>());
    }

    [Fact]
    public async Task Gemini_sends_the_key_header_and_reads_the_first_part()
    {
        var stub = new Stub(HttpStatusCode.OK, """{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}""");

        var text = await LlmCompletion.For(Provider("gemini"), new HttpClient(stub))!.Complete("hi", "gem", 1);

        Assert.Equal("ok", text);
        Assert.Equal("https://generativelanguage.googleapis.com/v1beta/models/gem:generateContent", stub.Request!.RequestUri!.ToString());
        Assert.Equal("k", stub.Request.Headers.GetValues("x-goog-api-key").Single());
    }

    [Theory]
    [InlineData("openai-compatible", """{"choices":[]}""")]
    [InlineData("gemini", """{"candidates":[]}""")]
    [InlineData("anthropic", """{"content":[]}""")]
    public async Task A_malformed_completion_is_a_clear_error(string transport, string body)
    {
        var llm = LlmCompletion.For(Provider(transport, "http://x"), new HttpClient(new Stub(HttpStatusCode.OK, body)))!;

        await Assert.ThrowsAsync<InvalidOperationException>(() => llm.Complete("hi", "m", 1));
    }

    [Theory]
    [InlineData("openai-compatible", null, "k")]
    [InlineData("gemini", null, null)]
    [InlineData("anthropic", null, null)]
    public void A_misconfigured_provider_has_no_client(string transport, string? baseUrl, string? key) =>
        Assert.Null(LlmCompletion.For(Provider(transport, baseUrl, key), new HttpClient(new Stub(HttpStatusCode.OK, "{}"))));

    [Fact]
    public async Task The_provider_test_reports_ok_with_the_reply_and_errors_with_the_reason()
    {
        var ok = await ProviderTester.Run("p", Provider("anthropic", "https://api.test"), new HttpClient(new Stub(HttpStatusCode.OK, """{"content":[{"type":"text","text":"ok"}]}""")));
        var bad = await ProviderTester.Run("p", Provider("anthropic", "https://api.test"), new HttpClient(new Stub(HttpStatusCode.Unauthorized, "{}")));
        var noModel = await ProviderTester.Run("p", Provider("openai-compatible", "http://x"), new HttpClient(new Stub(HttpStatusCode.OK, "{}")));
        var unconfigured = await ProviderTester.Run("p", Provider("gemini", null, null), new HttpClient(new Stub(HttpStatusCode.OK, "{}")));

        Assert.True(ok["ok"]!.GetValue<bool>());
        Assert.Equal("ok", ok["message"]!.GetValue<string>());
        Assert.False(bad["ok"]!.GetValue<bool>());
        Assert.Equal("set a test model for this provider before testing", noModel["error"]!.GetValue<string>());
        Assert.Equal("provider is not fully configured", unconfigured["error"]!.GetValue<string>());
    }
}
