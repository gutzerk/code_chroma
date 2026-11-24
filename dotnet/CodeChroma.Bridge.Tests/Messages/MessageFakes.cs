using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using CodeChroma.Bridge.Messages;

namespace CodeChroma.Bridge.Tests.Messages;

/// <summary>A fake Slack/Graph/login server: answers by "METHOD path" (query stripped) and records every request.</summary>
public sealed class FakeApi : HttpMessageHandler
{
    private readonly ConcurrentDictionary<string, Func<HttpRequestMessage, string, HttpResponseMessage>> _routes = new();

    public ConcurrentQueue<(HttpRequestMessage Request, string Body)> Requests { get; } = new();

    public FakeApi On(string method, string path, JsonNode body, HttpStatusCode status = HttpStatusCode.OK) =>
        On(method, path, (_, _) => Respond(body, status));

    public FakeApi On(string method, string path, Func<HttpRequestMessage, string, HttpResponseMessage> reply)
    {
        _routes[$"{method} {path}"] = reply;
        return this;
    }

    public IEnumerable<string> Paths => Requests.Select(r => r.Request.RequestUri!.AbsolutePath);

    public static HttpResponseMessage Respond(JsonNode body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Enqueue((request, body));
        return _routes.TryGetValue($"{request.Method} {request.RequestUri!.AbsolutePath}", out var reply)
            ? reply(request, body)
            : Respond(new JsonObject { ["ok"] = false, ["error"] = "not_routed" }, HttpStatusCode.NotFound);
    }
}

/// <summary>A scripted Socket Mode connection: frames pushed by the test, acks recorded.</summary>
public sealed class FakeSocket : ISocketConnection
{
    private readonly Channel<string?> _frames = Channel.CreateUnbounded<string?>();

    public ConcurrentQueue<string> Sent { get; } = new();

    public void Push(JsonNode frame) => _frames.Writer.TryWrite(frame.ToJsonString());

    public void Close() => _frames.Writer.TryWrite(null);

    public async Task<string?> ReceiveAsync(CancellationToken cancel) => await _frames.Reader.ReadAsync(cancel);

    public Task SendAsync(string text, CancellationToken cancel)
    {
        Sent.Enqueue(text);
        return Task.CompletedTask;
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

/// <summary>Canned Slack Web API answers for one workspace with a channel, a DM and a quiet channel.</summary>
public static class SlackFixture
{
    public const string Me = "UME";

    public static FakeApi Workspace(FakeApi? api = null)
    {
        api ??= new FakeApi();
        return api
            .On("GET", "/api/auth.test", new JsonObject
            {
                ["ok"] = true, ["user_id"] = Me, ["team_id"] = "T1", ["team"] = "Acme", ["user"] = "me", ["url"] = "https://acme.slack.com/",
            })
            .On("POST", "/api/apps.connections.open", new JsonObject { ["ok"] = true, ["url"] = "wss://fake.slack/socket" })
            .On("GET", "/api/users.conversations", new JsonObject
            {
                ["ok"] = true,
                ["channels"] = new JsonArray(
                    new JsonObject { ["id"] = "C1", ["name"] = "backend", ["is_channel"] = true },
                    new JsonObject { ["id"] = "D1", ["is_im"] = true, ["user"] = "UMAYA" },
                    new JsonObject { ["id"] = "C2", ["name"] = "quiet", ["is_channel"] = true }),
                ["response_metadata"] = new JsonObject { ["next_cursor"] = "" },
            })
            .On("GET", "/api/conversations.info", (request, _) => FakeApi.Respond(new JsonObject
            {
                ["ok"] = true,
                ["channel"] = new JsonObject { ["id"] = Query(request, "channel"), ["last_read"] = "1700000100.000000" },
            }))
            .On("GET", "/api/conversations.history", (request, _) => FakeApi.Respond(new JsonObject
            {
                ["ok"] = true, ["messages"] = History(Query(request, "channel")),
            }))
            .On("GET", "/api/users.info", (request, _) => FakeApi.Respond(new JsonObject
            {
                ["ok"] = true,
                ["user"] = new JsonObject { ["id"] = Query(request, "user"), ["profile"] = new JsonObject { ["real_name"] = "Maya Chen", ["display_name"] = "" } },
            }));
    }

    public static string Query(HttpRequestMessage request, string key) =>
        System.Web.HttpUtility.ParseQueryString(request.RequestUri!.Query)[key] ?? "";

    private static JsonArray History(string channel) => channel switch
    {
        "C1" => new JsonArray(
            new JsonObject { ["type"] = "message", ["user"] = "UMAYA", ["text"] = "Three runs dropped nodes <@UMAYA>", ["ts"] = "1700000300.000200" },
            new JsonObject { ["type"] = "message", ["user"] = Me, ["text"] = "mine", ["ts"] = "1700000250.000000" },
            new JsonObject { ["type"] = "message", ["subtype"] = "channel_join", ["user"] = "UBOB", ["text"] = "joined", ["ts"] = "1700000240.000000" },
            new JsonObject { ["type"] = "message", ["user"] = "UBOB", ["text"] = "reply", ["ts"] = "1700000230.000000", ["thread_ts"] = "1700000001.000000" }),
        "D1" => new JsonArray(new JsonObject { ["type"] = "message", ["user"] = "UMAYA", ["text"] = "ping", ["ts"] = "1700000200.000000" }),
        _ => [],
    };
}
