using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Messages;
using CodeChroma.Bridge.Tests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace CodeChroma.Bridge.Tests.Messages;

public class MessageRoutesTests
{
    private sealed class Rig : IDisposable
    {
        public FakeApi Api { get; } = new();
        public MemoryVault Vault { get; } = new();
        public BridgeHost Host { get; }

        public Rig(string? defaultClient = "default-client", Action<MemoryVault>? seed = null)
        {
            seed?.Invoke(Vault);
            SlackFixture.Workspace(Api);
            OutlookSourceTests.Mailbox(Api);
            var options = new MessagesOptions
            {
                Handler = Api, DefaultOutlookClientId = defaultClient,
                SlackSocket = (_, _) => Task.FromResult<ISocketConnection>(new FakeSocket()),
            };
            Host = new BridgeHost(configure: services =>
            {
                services.AddSingleton(options);
                services.AddSingleton<ITokenVault>(Vault);
            });
        }

        public async Task<JsonObject> Get(string path) => (await Host.Client.GetFromJsonAsync<JsonObject>(path))!;

        public void Dispose() => Host.Dispose();
    }

    [Fact]
    public async Task With_nothing_connected_the_feed_is_empty_and_both_sources_disconnected()
    {
        using var rig = new Rig();

        var body = await rig.Get("/messages/unread");

        Assert.Equal(("disconnected", "disconnected", 0),
            (body["sources"]!["slack"]!["state"]!.GetValue<string>(), body["sources"]!["outlook"]!["state"]!.GetValue<string>(), body["items"]!.AsArray().Count));
    }

    [Fact]
    public async Task A_token_with_the_wrong_prefix_is_refused()
    {
        using var rig = new Rig();

        var response = await rig.Host.Client.PostAsJsonAsync("/integrations/slack", new { user_token = "xoxb-1", app_token = "xapp-1" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Connecting_slack_saves_the_tokens_and_fills_the_feed()
    {
        using var rig = new Rig();

        var response = await rig.Host.Client.PostAsJsonAsync("/integrations/slack", new { user_token = "xoxp-1", app_token = "xapp-1" });
        await SlackSourceTests.WaitUntil(() => rig.Get("/messages/unread").Result["items"]!.AsArray().Count == 2);

        var integrations = await rig.Get("/integrations");
        Assert.Equal((HttpStatusCode.OK, "xoxp-1", true, "Acme"),
            (response.StatusCode, rig.Vault.Get(VaultKeys.SlackUserToken), integrations["slack"]!["connected"]!.GetValue<bool>(), integrations["slack"]!["workspace"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Slack_refusing_the_user_token_is_a_400_and_nothing_is_saved()
    {
        using var rig = new Rig();
        rig.Api.On("GET", "/api/auth.test", new JsonObject { ["ok"] = false, ["error"] = "invalid_auth" });

        var response = await rig.Host.Client.PostAsJsonAsync("/integrations/slack", new { user_token = "xoxp-bad", app_token = "xapp-1" });

        Assert.Equal((HttpStatusCode.BadRequest, (string?)null), (response.StatusCode, rig.Vault.Get(VaultKeys.SlackUserToken)));
    }

    [Fact]
    public async Task Outlook_connect_returns_a_pkce_authorize_url_back_to_the_bridge()
    {
        using var rig = new Rig();

        var response = await rig.Host.Client.PostAsJsonAsync("/integrations/outlook/connect", new { });
        var url = new Uri((await response.Content.ReadFromJsonAsync<JsonObject>())!["auth_url"]!.GetValue<string>());

        var query = System.Web.HttpUtility.ParseQueryString(url.Query);
        Assert.Equal(("/common/oauth2/v2.0/authorize", "default-client", "S256", true),
            (url.AbsolutePath, query["client_id"], query["code_challenge_method"], query["redirect_uri"]!.EndsWith("/integrations/outlook/callback")));
    }

    [Fact]
    public async Task Without_a_default_client_id_outlook_needs_the_users_own()
    {
        using var rig = new Rig(defaultClient: null);

        var response = await rig.Host.Client.PostAsJsonAsync("/integrations/outlook/connect", new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task The_callback_exchanges_the_code_and_starts_polling()
    {
        using var rig = new Rig();
        var connect = await rig.Host.Client.PostAsJsonAsync("/integrations/outlook/connect", new { client_id = "own-client", tenant = "organizations" });
        rig.Api.On("POST", "/organizations/oauth2/v2.0/token", new JsonObject { ["access_token"] = "a", ["refresh_token"] = "r-1", ["expires_in"] = 3600 });
        var url = new Uri((await connect.Content.ReadFromJsonAsync<JsonObject>())!["auth_url"]!.GetValue<string>());
        var state = System.Web.HttpUtility.ParseQueryString(url.Query)["state"];

        var callback = await rig.Host.Client.GetAsync($"/integrations/outlook/callback?code=abc&state={state}");
        await SlackSourceTests.WaitUntil(() => rig.Get("/messages/unread").Result["items"]!.AsArray().Count == 2);

        var exchange = rig.Api.Requests.First(r => r.Request.RequestUri!.AbsolutePath == "/organizations/oauth2/v2.0/token").Body;
        Assert.Equal((HttpStatusCode.OK, "own-client", true),
            (callback.StatusCode, rig.Vault.Get(VaultKeys.OutlookClientId), exchange.Contains("code_verifier=") && exchange.Contains("code=abc")));
    }

    [Fact]
    public async Task A_callback_with_an_unknown_state_is_refused()
    {
        using var rig = new Rig();

        var callback = await rig.Host.Client.GetAsync("/integrations/outlook/callback?code=abc&state=forged");

        Assert.Equal((HttpStatusCode.BadRequest, (string?)null), (callback.StatusCode, rig.Vault.Get(VaultKeys.OutlookRefreshToken)));
    }

    [Fact]
    public async Task Disconnecting_removes_the_tokens_and_the_items()
    {
        using var rig = new Rig();
        await rig.Host.Client.PostAsJsonAsync("/integrations/slack", new { user_token = "xoxp-1", app_token = "xapp-1" });
        await SlackSourceTests.WaitUntil(() => rig.Get("/messages/unread").Result["items"]!.AsArray().Count == 2);

        var response = await rig.Host.Client.DeleteAsync("/integrations/slack");

        var body = await rig.Get("/messages/unread");
        Assert.Equal((HttpStatusCode.OK, (string?)null, 0), (response.StatusCode, rig.Vault.Get(VaultKeys.SlackAppToken), body["items"]!.AsArray().Count));
    }

    [Fact]
    public async Task Saved_tokens_start_the_source_with_the_bridge()
    {
        using var rig = new Rig(seed: vault =>
        {
            vault.Set(VaultKeys.SlackUserToken, "xoxp-1");
            vault.Set(VaultKeys.SlackAppToken, "xapp-1");
        });

        await SlackSourceTests.WaitUntil(() => rig.Get("/messages/unread").Result["items"]!.AsArray().Count == 2);

        Assert.Equal("connected", (await rig.Get("/messages/unread"))["sources"]!["slack"]!["state"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_slack_manifest_asks_for_the_planned_user_scopes()
    {
        using var rig = new Rig();

        var manifest = await rig.Get("/integrations/slack/manifest");

        Assert.Equal(["channels:history", "channels:read", "groups:history", "groups:read", "im:history", "im:read", "mpim:history", "mpim:read", "users:read"],
            manifest["oauth_config"]!["scopes"]!["user"]!.AsArray().Select(s => s!.GetValue<string>()).Order());
    }

    [Fact]
    public async Task A_focus_refresh_is_throttled()
    {
        using var rig = new Rig();

        var first = await rig.Host.Client.PostAsync("/messages/refresh", null);
        var second = await rig.Host.Client.PostAsync("/messages/refresh", null);

        Assert.Equal((true, false), ((await first.Content.ReadFromJsonAsync<JsonObject>())!["started"]!.GetValue<bool>(), (await second.Content.ReadFromJsonAsync<JsonObject>())!["started"]!.GetValue<bool>()));
    }
}
