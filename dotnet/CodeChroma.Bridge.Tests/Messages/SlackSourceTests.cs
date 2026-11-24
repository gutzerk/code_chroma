using System.Text.Json.Nodes;
using CodeChroma.Bridge.Messages;

namespace CodeChroma.Bridge.Tests.Messages;

public class SlackSourceTests
{
    private static (SlackSource Source, UnreadFeed Feed, FakeApi Api, List<int> Pings) Create(FakeApi? api = null)
    {
        api ??= SlackFixture.Workspace();
        var options = new MessagesOptions { Handler = api };
        var pings = new List<int>();
        var feed = new UnreadFeed(() => pings.Add(1));
        var source = new SlackSource(new SlackApi(new HttpClient(api), options.SlackApi, "xoxp-1", "xapp-1"), options, TimeProvider.System);
        return (source, feed, api, pings);
    }

    [Fact]
    public async Task A_full_recheck_lists_only_messages_others_wrote_after_last_read()
    {
        var (source, feed, _, _) = Create();

        await source.RecheckAsync(feed, CancellationToken.None);

        var items = feed.Items("slack").OrderBy(i => i.Id).Select(i => (i.Id, i.Where, i.From)).ToList();
        Assert.Equal([("slack:T1/C1/1700000300.000200", "#backend", "Maya Chen"), ("slack:T1/D1/1700000200.000000", "Direct message", "Maya Chen")], items);
    }

    [Fact]
    public async Task An_item_carries_a_deep_link_and_a_web_permalink()
    {
        var (source, feed, _, _) = Create();

        await source.RecheckAsync(feed, CancellationToken.None);

        var item = feed.Items("slack").Single(i => i.Group == "C1");
        Assert.Equal(("slack://channel?team=T1&id=C1&message=1700000300.000200", "https://acme.slack.com/archives/C1/p1700000300000200"), (item.OpenUrl, item.WebUrl));
    }

    [Fact]
    public async Task A_socket_message_from_someone_else_is_acked_and_added()
    {
        var (source, feed, _, _) = Create();
        var socket = new FakeSocket();
        var frame = new JsonObject
        {
            ["type"] = "events_api", ["envelope_id"] = "E1",
            ["payload"] = new JsonObject { ["event"] = new JsonObject { ["type"] = "message", ["channel"] = "C2", ["user"] = "UMAYA", ["text"] = "hi", ["ts"] = "1700000400.000000" } },
        };

        await source.OnFrameAsync(socket, frame.ToJsonString(), feed, CancellationToken.None);

        Assert.Equal(("{\"envelope_id\":\"E1\"}", "slack:T1/C2/1700000400.000000"), (string.Join(",", socket.Sent), feed.Items("slack").Single().Id));
    }

    [Fact]
    public async Task Writing_in_a_conversation_clears_its_unread_items()
    {
        var (source, feed, _, _) = Create();
        await source.RecheckAsync(feed, CancellationToken.None);
        var frame = new JsonObject
        {
            ["type"] = "events_api", ["envelope_id"] = "E2",
            ["payload"] = new JsonObject { ["event"] = new JsonObject { ["type"] = "message", ["channel"] = "C1", ["user"] = SlackFixture.Me, ["text"] = "on it", ["ts"] = "1700000500.000000" } },
        };

        await source.OnFrameAsync(new FakeSocket(), frame.ToJsonString(), feed, CancellationToken.None);

        Assert.Equal(["D1"], feed.Items("slack").Select(i => i.Group));
    }

    [Fact]
    public async Task A_thread_reply_by_the_user_keeps_the_channel_unread()
    {
        var (source, feed, _, _) = Create();
        await source.RecheckAsync(feed, CancellationToken.None);
        var frame = new JsonObject
        {
            ["type"] = "events_api", ["envelope_id"] = "E4",
            ["payload"] = new JsonObject
            {
                ["event"] = new JsonObject
                {
                    ["type"] = "message", ["channel"] = "C1", ["user"] = SlackFixture.Me, ["text"] = "in a thread",
                    ["ts"] = "1700000500.000000", ["thread_ts"] = "1700000001.000000",
                },
            },
        };

        await source.OnFrameAsync(new FakeSocket(), frame.ToJsonString(), feed, CancellationToken.None);

        Assert.Equal(["C1", "D1"], feed.Items("slack").Select(i => i.Group).Order());
    }

    [Fact]
    public async Task A_rate_limited_conversation_keeps_its_items_while_the_others_refresh()
    {
        var api = SlackFixture.Workspace();
        var (source, feed, _, _) = Create(api);
        await source.RecheckAsync(feed, CancellationToken.None);
        api.On("GET", "/api/conversations.history", (request, _) =>
        {
            if (SlackFixture.Query(request, "channel") != "D1") return FakeApi.Respond(new JsonObject { ["ok"] = true, ["messages"] = new JsonArray() });
            var limited = FakeApi.Respond(new JsonObject { ["ok"] = false, ["error"] = "ratelimited" }, System.Net.HttpStatusCode.TooManyRequests);
            limited.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.Zero);
            return limited;
        });

        await source.RecheckAsync(feed, CancellationToken.None);

        Assert.Equal(["D1"], feed.Items("slack").Select(i => i.Group));
    }

    [Fact]
    public async Task A_refused_user_token_still_fails_the_recheck()
    {
        var api = SlackFixture.Workspace();
        api.On("GET", "/api/conversations.history", new JsonObject { ["ok"] = false, ["error"] = "token_revoked" });
        var (source, feed, _, _) = Create(api);

        var error = await Assert.ThrowsAsync<SlackApiException>(() => source.RecheckAsync(feed, CancellationToken.None));

        Assert.Equal("token_revoked", error.Error);
    }

    [Fact]
    public async Task A_disconnect_frame_asks_to_reconnect()
    {
        var (source, feed, _, _) = Create();

        var keep = await source.OnFrameAsync(new FakeSocket(), """{"type":"disconnect","reason":"refresh_requested"}""", feed, CancellationToken.None);

        Assert.False(keep);
    }

    [Fact]
    public async Task Rechecking_open_conversations_drops_one_read_in_slack()
    {
        var api = SlackFixture.Workspace();
        var (source, feed, _, _) = Create(api);
        await source.RecheckAsync(feed, CancellationToken.None);
        api.On("GET", "/api/conversations.info", (request, _) => FakeApi.Respond(new JsonObject
        {
            ["ok"] = true, ["channel"] = new JsonObject { ["id"] = SlackFixture.Query(request, "channel"), ["last_read"] = "1700000900.000000" },
        }));
        api.On("GET", "/api/conversations.history", new JsonObject { ["ok"] = true, ["messages"] = new JsonArray() });

        await source.RecheckOpenAsync(feed, CancellationToken.None);

        Assert.Empty(feed.Items("slack"));
    }

    [Fact]
    public async Task A_rate_limited_call_is_retried_after_retry_after()
    {
        var api = SlackFixture.Workspace();
        var calls = 0;
        api.On("GET", "/api/auth.test", (_, _) =>
        {
            if (calls++ == 0)
            {
                var limited = FakeApi.Respond(new JsonObject { ["ok"] = false, ["error"] = "ratelimited" }, System.Net.HttpStatusCode.TooManyRequests);
                limited.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.Zero);
                return limited;
            }
            return FakeApi.Respond(new JsonObject { ["ok"] = true, ["user_id"] = "UME", ["team_id"] = "T1", ["team"] = "Acme", ["user"] = "me", ["url"] = "" });
        });
        var (source, _, _, _) = Create(api);

        var identity = await source.IdentifyAsync(CancellationToken.None);

        Assert.Equal(("Acme", 2), (identity.Team, calls));
    }

    [Theory]
    [InlineData("see <https://x.dev|the docs> in <#C9|general>", "see the docs in #general")]
    [InlineData("<!here>  deploy\n\nat 5 &amp; 6", "@here deploy at 5 & 6")]
    [InlineData("raw <https://x.dev/a>", "raw https://x.dev/a")]
    public void A_preview_flattens_slack_markup(string text, string expected)
    {
        var (source, _, _, _) = Create();

        var preview = source.Preview(text);

        Assert.Equal(expected, preview);
    }

    [Fact]
    public async Task RunAsync_reads_the_socket_and_stops_on_cancel()
    {
        var api = SlackFixture.Workspace();
        var socket = new FakeSocket();
        var options = new MessagesOptions { Handler = api, SlackSocket = (_, _) => Task.FromResult<ISocketConnection>(socket) };
        var feed = new UnreadFeed(() => { });
        var source = new SlackSource(new SlackApi(new HttpClient(api), options.SlackApi, "xoxp-1", "xapp-1"), options, TimeProvider.System);
        using var stop = new CancellationTokenSource();
        var run = source.RunAsync(feed, stop.Token);
        socket.Push(new JsonObject
        {
            ["type"] = "events_api", ["envelope_id"] = "E3",
            ["payload"] = new JsonObject { ["event"] = new JsonObject { ["type"] = "message", ["channel"] = "C2", ["user"] = "UMAYA", ["text"] = "new", ["ts"] = "1700000600.000000" } },
        });
        await WaitUntil(() => feed.Items("slack").Any(i => i.Group == "C2"));

        await stop.CancelAsync();
        await run.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(("connected", 3), (feed.StateOf("slack").State, feed.Items("slack").Count));
    }

    internal static async Task WaitUntil(Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++) await Task.Delay(25);
        Assert.True(condition(), "condition was not met in time");
    }
}
