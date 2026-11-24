using System.Net;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Messages;

namespace CodeChroma.Bridge.Tests.Messages;

public class OutlookSourceTests
{
    public static FakeApi Mailbox(FakeApi? api = null, string rotated = "refresh-2")
    {
        api ??= new FakeApi();
        return api
            .On("POST", "/common/oauth2/v2.0/token", new JsonObject { ["access_token"] = "access-1", ["refresh_token"] = rotated, ["expires_in"] = 3600 })
            .On("GET", "/v1.0/me", new JsonObject { ["mail"] = "me@acme.dev" })
            .On("GET", "/v1.0/me/mailFolders/junkemail", new JsonObject { ["id"] = "F-JUNK" })
            .On("GET", "/v1.0/me/mailFolders/deleteditems", new JsonObject { ["id"] = "F-DEL" })
            .On("GET", "/v1.0/me/mailFolders", new JsonObject
            {
                ["value"] = new JsonArray(new JsonObject { ["id"] = "F-IN", ["displayName"] = "Inbox" }),
            })
            .On("GET", "/v1.0/me/messages", new JsonObject
            {
                ["value"] = new JsonArray(
                    Message("m1", "F-IN", "Release notes", "Please review\r\n the draft"),
                    Message("m2", "F-JUNK", "You won", "spam"),
                    Message("m3", "F-DEL", "Old", "gone"),
                    Message("m4", "F-OTHER", "", "")),
            });
    }

    private static JsonObject Message(string id, string folder, string subject, string body) => new()
    {
        ["id"] = id, ["parentFolderId"] = folder, ["subject"] = subject, ["bodyPreview"] = body,
        ["from"] = new JsonObject { ["emailAddress"] = new JsonObject { ["name"] = "Ana Ruiz", ["address"] = "ana@acme.dev" } },
        ["receivedDateTime"] = "2026-11-24T09:41:30Z", ["webLink"] = $"https://outlook.office.com/owa/?ItemID={id}",
    };

    private static (OutlookSource Source, UnreadFeed Feed, List<string> Saved) Create(FakeApi api)
    {
        var options = new MessagesOptions { Handler = api };
        var http = new HttpClient(api);
        var saved = new List<string>();
        var source = new OutlookSource(http, new OutlookAuth(http, options.Login, TimeProvider.System), options, TimeProvider.System,
            "client-1", "common", "refresh-1", saved.Add);
        return (source, new UnreadFeed(() => { }), saved);
    }

    [Fact]
    public async Task A_recheck_lists_unread_mail_outside_junk_and_deleted_items()
    {
        var (source, feed, _) = Create(Mailbox());

        await source.RecheckAsync(feed, CancellationToken.None);

        var items = feed.Items("outlook").OrderBy(i => i.Id).Select(i => (i.Id, i.Where, i.Preview)).ToList();
        Assert.Equal([("outlook:m1", "Inbox", "Release notes — Please review the draft"), ("outlook:m4", "Mail", "(no subject)")], items);
    }

    [Fact]
    public async Task The_graph_query_filters_on_unread()
    {
        var api = Mailbox();
        var (source, feed, _) = Create(api);

        await source.RecheckAsync(feed, CancellationToken.None);

        var query = Uri.UnescapeDataString(api.Requests.Single(r => r.Request.RequestUri!.AbsolutePath == "/v1.0/me/messages").Request.RequestUri!.Query);
        Assert.Contains("$filter=isRead eq false", query);
    }

    [Fact]
    public async Task A_rotated_refresh_token_is_saved()
    {
        var (source, feed, saved) = Create(Mailbox());

        await source.RecheckAsync(feed, CancellationToken.None);

        Assert.Equal(["refresh-2"], saved);
    }

    [Fact]
    public async Task A_revoked_grant_turns_the_source_into_an_error_with_a_reconnect_hint()
    {
        var api = Mailbox().On("POST", "/common/oauth2/v2.0/token", new JsonObject { ["error"] = "invalid_grant" }, HttpStatusCode.BadRequest);
        var (source, feed, _) = Create(api);
        using var stop = new CancellationTokenSource();

        var run = source.RunAsync(feed, stop.Token);
        await SlackSourceTests.WaitUntil(() => feed.StateOf("outlook").State == "error");
        await stop.CancelAsync();
        await run.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Contains("connect again", feed.StateOf("outlook").Error);
    }

    [Fact]
    public async Task The_next_page_link_is_followed()
    {
        var api = Mailbox();
        api.On("GET", "/v1.0/me/messages", (request, _) => FakeApi.Respond(request.RequestUri!.Query.Contains("skip")
            ? new JsonObject { ["value"] = new JsonArray(Message("p2", "F-IN", "Second", "page")) }
            : new JsonObject { ["value"] = new JsonArray(Message("p1", "F-IN", "First", "page")), ["@odata.nextLink"] = "https://graph.microsoft.com/v1.0/me/messages?$skip=100" }));
        var (source, feed, _) = Create(api);

        await source.RecheckAsync(feed, CancellationToken.None);

        Assert.Equal(["outlook:p1", "outlook:p2"], feed.Items("outlook").Select(i => i.Id).Order());
    }
}
