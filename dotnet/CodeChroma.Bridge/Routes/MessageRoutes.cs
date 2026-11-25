using System.Net;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Messages;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Routes;

/// <summary>The unread-messages feed and the Slack/Outlook integrations (C#-only, like workflows); see docs/architecture/unread-messages.md.</summary>
public static class MessageRoutes
{
    public const string OutlookCallbackPath = "/integrations/outlook/callback";

    private static readonly Lazy<string> Manifest = new(() =>
    {
        using var stream = typeof(MessageRoutes).Assembly.GetManifestResourceStream("slack-manifest.json")!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    });

    public static void Map(WebApplication app)
    {
        var messagesRoutes = app.MapGroup("/messages").AddEndpointFilter(LoopbackOnly);
        var integrationRoutes = app.MapGroup("/integrations").AddEndpointFilter(LoopbackOnly);
        MapMessages(messagesRoutes);
        MapIntegrations(integrationRoutes);
    }

    /// <summary>Refuses a request whose Host is not this machine's loopback, so a DNS-rebound page cannot read anyone's messages.</summary>
    private static async ValueTask<object?> LoopbackOnly(EndpointFilterInvocationContext context, EndpointFilterDelegate next) =>
        OriginGuard.IsLoopbackHost(context.HttpContext.Request.Host.Host)
            ? await next(context)
            : Reply.Error(StatusCodes.Status403Forbidden, "messages are only served to this machine's loopback address");

    private static void MapMessages(RouteGroupBuilder app)
    {
        app.MapGet("/unread", (MessagesService messages) => Reply.Json(messages.Feed.Snapshot()));

        app.MapPost("/refresh", (MessagesService messages) => Reply.Json(new JsonObject { ["started"] = messages.RefreshAll() }));
    }

    private static void MapIntegrations(RouteGroupBuilder app)
    {
        app.MapGet("", (MessagesService messages) => Reply.Json(messages.Status()));

        app.MapGet("/slack/manifest", () => Results.Text(Manifest.Value, "application/json; charset=utf-8"));

        app.MapPost("/slack", async (HttpRequest request, MessagesService messages) =>
        {
            var body = await Reply.LenientBody(request);
            return await Guard(async () =>
            {
                var identity = await messages.ConnectSlackAsync(Json.Str(body["user_token"]) ?? "", Json.Str(body["app_token"]) ?? "", request.HttpContext.RequestAborted);
                return Reply.Json(new JsonObject { ["workspace"] = identity.Team, ["user"] = identity.User });
            });
        });

        app.MapPost("/outlook/connect", async (HttpRequest request, MessagesService messages) =>
        {
            var body = await Reply.LenientBody(request);
            return await Guard(() =>
            {
                var url = messages.BeginOutlook(Json.Str(body["client_id"]), Json.Str(body["tenant"]), RedirectUri(request));
                return Task.FromResult(Reply.Json(new JsonObject { ["auth_url"] = url.AbsoluteUri }));
            });
        });

        app.MapGet(OutlookCallbackPath["/integrations".Length..], async (HttpRequest request, MessagesService messages) =>
        {
            var query = request.Query;
            try
            {
                await messages.CompleteOutlookAsync(query["state"], query["code"], query["error_description"].FirstOrDefault() ?? query["error"], request.HttpContext.RequestAborted);
                return Page("Outlook is connected", "You can close this tab and return to CodeChroma.");
            }
            catch (IntegrationException error)
            {
                messages.ReportOutlookSignInFailure(error.Message);
                return Page("Outlook was not connected", error.Message, error.Status);
            }
            catch (HttpRequestException error)
            {
                var message = "Microsoft sign-in is unreachable: " + error.Message;
                messages.ReportOutlookSignInFailure(message);
                return Page("Outlook was not connected", message, 502);
            }
        });

        app.MapDelete("/{source}", (string source, MessagesService messages) => Guard(async () =>
        {
            await messages.DisconnectAsync(source);
            return Reply.Json(new JsonObject { ["source"] = source, ["connected"] = false });
        }));
    }

    /// <summary>The loopback redirect back into this bridge: the IPv4 address it listens on, which Entra matches on any port for a public client.</summary>
    public static string RedirectUri(HttpRequest request)
    {
        var port = request.Host.Port ?? (request.IsHttps ? 443 : 80);
        return $"http://127.0.0.1:{port}{OutlookCallbackPath}";
    }

    private static async Task<IResult> Guard(Func<Task<IResult>> body)
    {
        try { return await body(); }
        catch (IntegrationException error) { return Reply.Error(error.Status, error.Message); }
    }

    private static IResult Page(string title, string message, int status = 200)
    {
        var html = $"<!doctype html><meta charset=\"utf-8\"><title>{WebUtility.HtmlEncode(title)}</title>"
            + "<body style=\"font-family:system-ui,sans-serif;background:#1b1e27;color:#e6e8ef;display:grid;place-items:center;height:100vh;margin:0\">"
            + $"<main style=\"max-width:28rem;text-align:center\"><h1 style=\"font-size:1.25rem\">{WebUtility.HtmlEncode(title)}</h1><p>{WebUtility.HtmlEncode(message)}</p></main>";
        return Results.Text(html, "text/html; charset=utf-8", statusCode: status);
    }
}
