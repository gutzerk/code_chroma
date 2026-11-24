using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Messages;

/// <summary>A thin Slack Web API client: Bearer auth, ok:false as SlackApiException, 429 honoured with Retry-After.</summary>
public sealed class SlackApi(HttpClient http, Uri baseUri, string userToken, string appToken)
{
    public async Task<JsonObject> Call(string method, IReadOnlyDictionary<string, string>? args = null, bool useAppToken = false, CancellationToken cancel = default)
    {
        for (var attempt = 0; ; attempt++)
        {
            using var request = new HttpRequestMessage(useAppToken ? HttpMethod.Post : HttpMethod.Get, Url(method, useAppToken ? null : args));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", useAppToken ? appToken : userToken);
            if (useAppToken) request.Content = new FormUrlEncodedContent(args ?? new Dictionary<string, string>());
            using var response = await http.SendAsync(request, cancel);
            if (response.StatusCode == HttpStatusCode.TooManyRequests && attempt < 3)
            {
                var wait = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(1 + attempt);
                await Task.Delay(wait > TimeSpan.FromSeconds(30) ? TimeSpan.FromSeconds(30) : wait, cancel);
                continue;
            }
            var text = await response.Content.ReadAsStringAsync(cancel);
            JsonObject body;
            try { body = JsonNode.Parse(text) as JsonObject ?? throw new SlackApiException(method, "invalid_response"); }
            catch (JsonException) { throw new SlackApiException(method, $"http_{(int)response.StatusCode}"); }
            if (!Json.Bool(body["ok"])) throw new SlackApiException(method, Json.Str(body["error"]) ?? "unknown_error");
            return body;
        }
    }

    private Uri Url(string method, IReadOnlyDictionary<string, string>? args)
    {
        var query = args is { Count: > 0 } ? "?" + string.Join('&', args.Select(a => $"{Uri.EscapeDataString(a.Key)}={Uri.EscapeDataString(a.Value)}")) : "";
        return new Uri(baseUri, method + query);
    }
}

public sealed class SlackApiException(string method, string error) : Exception($"Slack {method}: {error}")
{
    public string Error { get; } = error;
}

/// <summary>Who the user token belongs to (auth.test).</summary>
public sealed record SlackIdentity(string UserId, string TeamId, string Team, string User, string Url);

/// <summary>Unread Slack messages: users.conversations + last_read re-checks, kept live through Socket Mode.</summary>
public sealed class SlackSource(SlackApi api, MessagesOptions options, TimeProvider clock) : IMessageSource
{
    public const string SourceName = "slack";

    /// <summary>Subtypes that are not something a person wrote (joins, topic changes, edits, deletions).</summary>
    private static readonly HashSet<string> CountedSubtypes = ["thread_broadcast", "file_share", "bot_message", "me_message"];

    private sealed record Conversation(string Id, string Kind, string? Name, string? ImUser);

    private readonly ConcurrentDictionary<string, string> _userNames = new();
    private readonly ConcurrentDictionary<string, Conversation> _conversations = new();
    private readonly ConcurrentDictionary<string, long> _socketChanges = new();
    private readonly SemaphoreSlim _recheckGate = new(1, 1);
    private SlackIdentity? _identity;
    private volatile string? _socketError;

    public string Name => SourceName;

    /// <summary>Checks the user token and caches who it belongs to.</summary>
    public async Task<SlackIdentity> IdentifyAsync(CancellationToken cancel)
    {
        if (_identity is not null) return _identity;
        var body = await api.Call("auth.test", cancel: cancel);
        _identity = new SlackIdentity(
            Json.Str(body["user_id"]) ?? "", Json.Str(body["team_id"]) ?? "", Json.Str(body["team"]) ?? "",
            Json.Str(body["user"]) ?? "", Json.Str(body["url"]) ?? "");
        return _identity;
    }

    public async Task RecheckAsync(UnreadFeed feed, CancellationToken cancel)
    {
        await _recheckGate.WaitAsync(cancel);
        try
        {
            var me = await IdentifyAsync(cancel);
            var conversations = await ListConversationsAsync(cancel);
            var listed = conversations.Select(c => c.Id).ToHashSet();
            feed.ReplaceWhere(SourceName, i => !listed.Contains(i.Group), [], clock.GetUtcNow(), _socketError);
            using var gate = new SemaphoreSlim(options.SlackConcurrency);
            await Task.WhenAll(conversations.Select(async conversation =>
            {
                await gate.WaitAsync(cancel);
                try
                {
                    if (await ReadAsync(conversation, me, cancel) is { } fresh)
                        feed.ReplaceWhere(SourceName, i => i.Group == conversation.Id, fresh, clock.GetUtcNow(), _socketError);
                }
                finally { gate.Release(); }
            }));
        }
        finally { _recheckGate.Release(); }
    }

    /// <summary>Re-reads only the conversations that still have unread items, so a read elsewhere clears them.</summary>
    public async Task RecheckOpenAsync(UnreadFeed feed, CancellationToken cancel)
    {
        await _recheckGate.WaitAsync(cancel);
        try
        {
            var me = await IdentifyAsync(cancel);
            foreach (var group in feed.Items(SourceName).Select(i => i.Group).Distinct().ToList())
            {
                if (!_conversations.TryGetValue(group, out var conversation)) continue;
                if (await ReadAsync(conversation, me, cancel) is { } fresh) feed.ReplaceWhere(SourceName, i => i.Group == group, fresh, clock.GetUtcNow(), _socketError);
            }
        }
        finally { _recheckGate.Release(); }
    }

    /// <summary>One conversation's unread items, or null to keep what the feed has (a socket event landed mid-read, or Slack refused this one call).</summary>
    private async Task<IReadOnlyList<UnreadItem>?> ReadAsync(Conversation conversation, SlackIdentity me, CancellationToken cancel)
    {
        var before = _socketChanges.GetValueOrDefault(conversation.Id);
        IReadOnlyList<UnreadItem> fresh;
        try { fresh = await UnreadInAsync(conversation, me, cancel); }
        catch (SlackApiException error) when (error.Error is "channel_not_found" or "not_in_channel") { fresh = []; }
        catch (SlackApiException error) when (!IsAuthFailure(error)) { return null; }
        return _socketChanges.GetValueOrDefault(conversation.Id) == before ? fresh : null;
    }

    private static bool IsAuthFailure(SlackApiException error) =>
        error.Error is "invalid_auth" or "not_authed" or "token_revoked" or "token_expired" or "account_inactive";

    public async Task RunAsync(UnreadFeed feed, CancellationToken stop)
    {
        feed.Connecting(SourceName);
        var socket = SocketLoop(feed, stop);
        await SafeRecheck(feed, full: true, stop);
        var nextFull = clock.GetUtcNow() + options.SlackFullRecheck;
        try
        {
            while (!stop.IsCancellationRequested)
            {
                await Task.Delay(options.SlackOpenRecheck, clock, stop);
                var full = clock.GetUtcNow() >= nextFull;
                await SafeRecheck(feed, full, stop);
                if (full) nextFull = clock.GetUtcNow() + options.SlackFullRecheck;
            }
        }
        catch (OperationCanceledException) { }
        await socket;
    }

    private async Task SafeRecheck(UnreadFeed feed, bool full, CancellationToken stop)
    {
        try
        {
            if (full) await RecheckAsync(feed, stop);
            else await RecheckOpenAsync(feed, stop);
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        catch (Exception error) { feed.Fail(SourceName, Describe(error)); }
    }

    private async Task SocketLoop(UnreadFeed feed, CancellationToken stop)
    {
        var backoff = TimeSpan.FromSeconds(2);
        var first = true;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                var open = await api.Call("apps.connections.open", useAppToken: true, cancel: stop);
                var url = Json.Str(open["url"]) ?? throw new SlackApiException("apps.connections.open", "no_url");
                await using var socket = await options.SlackSocket(new Uri(url), stop);
                var recovered = _socketError is not null;
                _socketError = null;
                if (!first || recovered) await SafeRecheck(feed, full: true, stop);
                first = false;
                backoff = TimeSpan.FromSeconds(2);
                while (await socket.ReceiveAsync(stop) is { } frame)
                    if (!await OnFrameAsync(socket, frame, feed, stop)) break;
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (SlackApiException error) when (error.Error is "invalid_auth" or "not_allowed_token_type" or "token_revoked")
            {
                _socketError = "Slack app-level token was refused: " + error.Error;
                feed.Fail(SourceName, _socketError);
            }
            catch (Exception) { /* the socket dropped; reconnect below */ }
            try { await Task.Delay(backoff, clock, stop); }
            catch (OperationCanceledException) { return; }
            backoff = TimeSpan.FromSeconds(Math.Min(60, backoff.TotalSeconds * 2));
        }
    }

    /// <summary>Acks one Socket Mode envelope and applies its message event; false asks to reconnect.</summary>
    public async Task<bool> OnFrameAsync(ISocketConnection socket, string frame, UnreadFeed feed, CancellationToken cancel)
    {
        JsonObject? envelope;
        try { envelope = JsonNode.Parse(frame) as JsonObject; }
        catch (JsonException) { return true; }
        if (envelope is null) return true;
        if (Json.Str(envelope["envelope_id"]) is { } envelopeId)
            await socket.SendAsync(new JsonObject { ["envelope_id"] = envelopeId }.ToJsonString(), cancel);
        var type = Json.Str(envelope["type"]);
        if (type == "disconnect") return false;
        if (type == "events_api" && envelope["payload"]?["event"] is JsonObject message) await OnMessageAsync(message, feed, cancel);
        return true;
    }

    private async Task OnMessageAsync(JsonObject message, UnreadFeed feed, CancellationToken cancel)
    {
        if (Json.Str(message["type"]) != "message" || Json.Str(message["channel"]) is not { } channel) return;
        var me = await IdentifyAsync(cancel);
        var subtype = Json.Str(message["subtype"]);
        if (subtype == "message_deleted")
        {
            var deletedTs = Json.Str(message["deleted_ts"]);
            _socketChanges.AddOrUpdate(channel, 1, (_, n) => n + 1);
            feed.RemoveWhere(SourceName, i => i.Group == channel && i.Id == ItemId(me, channel, deletedTs ?? ""));
            return;
        }
        if (!Counts(message, me)) return;
        _socketChanges.AddOrUpdate(channel, 1, (_, n) => n + 1);
        if (Json.Str(message["user"]) == me.UserId)
        {
            feed.RemoveWhere(SourceName, i => i.Group == channel);
            return;
        }
        var conversation = await ConversationAsync(channel, message, cancel);
        feed.Upsert(SourceName, await ToItemAsync(conversation, message, me, cancel));
    }

    private async Task<List<Conversation>> ListConversationsAsync(CancellationToken cancel)
    {
        var result = new List<Conversation>();
        string? cursor = null;
        do
        {
            var args = new Dictionary<string, string>
            {
                ["types"] = "public_channel,private_channel,mpim,im", ["exclude_archived"] = "true", ["limit"] = "200",
            };
            if (cursor is not null) args["cursor"] = cursor;
            var page = await api.Call("users.conversations", args, cancel: cancel);
            foreach (var node in page["channels"]?.AsArray() ?? [])
                if (node is JsonObject channel && Remember(channel) is { } conversation) result.Add(conversation);
            cursor = Json.NonEmptyStr(page["response_metadata"]?["next_cursor"]);
        } while (cursor is not null && result.Count < options.SlackMaxConversations);
        return result.Count > options.SlackMaxConversations ? result.Take(options.SlackMaxConversations).ToList() : result;
    }

    private Conversation? Remember(JsonObject channel)
    {
        if (Json.Str(channel["id"]) is not { } id) return null;
        var kind = Json.Bool(channel["is_im"]) ? "im" : Json.Bool(channel["is_mpim"]) ? "mpim" : Json.Bool(channel["is_private"]) ? "private" : "channel";
        var conversation = new Conversation(id, kind, Json.Str(channel["name"]), Json.Str(channel["user"]));
        _conversations[id] = conversation;
        return conversation;
    }

    private async Task<Conversation> ConversationAsync(string channel, JsonObject message, CancellationToken cancel)
    {
        if (_conversations.TryGetValue(channel, out var known)) return known;
        try
        {
            var info = await api.Call("conversations.info", new Dictionary<string, string> { ["channel"] = channel }, cancel: cancel);
            if (info["channel"] is JsonObject channelInfo && Remember(channelInfo) is { } fetched) return fetched;
        }
        catch (SlackApiException) { }
        var kind = Json.Str(message["channel_type"]) switch { "im" => "im", "mpim" => "mpim", "group" => "private", _ => "channel" };
        return new Conversation(channel, kind, null, null);
    }

    private async Task<IReadOnlyList<UnreadItem>> UnreadInAsync(Conversation conversation, SlackIdentity me, CancellationToken cancel)
    {
        var info = await api.Call("conversations.info", new Dictionary<string, string> { ["channel"] = conversation.Id }, cancel: cancel);
        if (Json.Str(info["channel"]?["last_read"]) is not { } lastRead) return [];
        var history = await api.Call("conversations.history", new Dictionary<string, string>
        {
            ["channel"] = conversation.Id, ["oldest"] = lastRead, ["inclusive"] = "false", ["limit"] = options.SlackMaxPerConversation.ToString(CultureInfo.InvariantCulture),
        }, cancel: cancel);
        var items = new List<UnreadItem>();
        foreach (var node in history["messages"]?.AsArray() ?? [])
        {
            if (node is not JsonObject message || !Counts(message, me) || Json.Str(message["user"]) == me.UserId) continue;
            if (!After(Json.Str(message["ts"]), lastRead)) continue;
            items.Add(await ToItemAsync(conversation, message, me, cancel));
        }
        return items;
    }

    private static bool Counts(JsonObject message, SlackIdentity me)
    {
        var subtype = Json.Str(message["subtype"]);
        if (subtype is not null && !CountedSubtypes.Contains(subtype)) return false;
        var ts = Json.Str(message["ts"]);
        var threadTs = Json.Str(message["thread_ts"]);
        return ts is not null && (threadTs is null || threadTs == ts || subtype == "thread_broadcast");
    }

    private async Task<UnreadItem> ToItemAsync(Conversation conversation, JsonObject message, SlackIdentity me, CancellationToken cancel)
    {
        var ts = Json.Str(message["ts"])!;
        var from = Json.Str(message["user"]) is { } user
            ? await UserNameAsync(user, cancel)
            : Json.Str(message["bot_profile"]?["name"]) ?? Json.Str(message["username"]) ?? "Slack";
        var where = conversation.Kind switch
        {
            "im" => "Direct message",
            "mpim" => "Group message",
            _ => "#" + (conversation.Name ?? conversation.Id),
        };
        var text = Preview(Json.Str(message["text"]) ?? "");
        var webUrl = me.Url.Length > 0 ? $"{me.Url.TrimEnd('/')}/archives/{conversation.Id}/p{ts.Replace(".", "", StringComparison.Ordinal)}" : null;
        return new UnreadItem(
            ItemId(me, conversation.Id, ts), SourceName, where, from, text, FromTs(ts),
            $"slack://channel?team={me.TeamId}&id={conversation.Id}&message={ts}", webUrl, conversation.Id);
    }

    private async Task<string> UserNameAsync(string userId, CancellationToken cancel)
    {
        if (_userNames.TryGetValue(userId, out var cached)) return cached;
        var name = userId;
        try
        {
            var body = await api.Call("users.info", new Dictionary<string, string> { ["user"] = userId }, cancel: cancel);
            var profile = body["user"]?["profile"];
            name = Json.NonEmptyStr(profile?["display_name"]) ?? Json.NonEmptyStr(profile?["real_name"]) ?? Json.NonEmptyStr(body["user"]?["name"]) ?? userId;
        }
        catch (SlackApiException) { }
        _userNames[userId] = name;
        return name;
    }

    /// <summary>Slack mrkdwn flattened to plain text: links to their labels, user mentions to names, whitespace collapsed.</summary>
    public string Preview(string text)
    {
        var flat = Regex.Replace(text, "<@([A-Z0-9]+)(?:\\|[^>]*)?>", m => "@" + (_userNames.TryGetValue(m.Groups[1].Value, out var n) ? n : m.Groups[1].Value));
        flat = Regex.Replace(flat, "<#[A-Z0-9]+\\|([^>]*)>", "#$1");
        flat = Regex.Replace(flat, "<!(here|channel|everyone)[^>]*>", "@$1");
        flat = Regex.Replace(flat, "<([^|>]+)\\|([^>]+)>", "$2");
        flat = Regex.Replace(flat, "<([^>]+)>", "$1");
        flat = WebUtility.HtmlDecode(Regex.Replace(flat, "\\s+", " ").Trim());
        return flat.Length > 200 ? flat[..199] + "…" : flat;
    }

    private static bool After(string? ts, string lastRead) =>
        decimal.TryParse(ts, NumberStyles.Float, CultureInfo.InvariantCulture, out var a)
        && (!decimal.TryParse(lastRead, NumberStyles.Float, CultureInfo.InvariantCulture, out var b) || a > b);

    private static string ItemId(SlackIdentity me, string channel, string ts) => $"slack:{me.TeamId}/{channel}/{ts}";

    private static DateTimeOffset FromTs(string ts) =>
        double.TryParse(ts, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)
            ? DateTimeOffset.FromUnixTimeMilliseconds((long)(seconds * 1000))
            : DateTimeOffset.UnixEpoch;

    public static string Describe(Exception error) => error switch
    {
        SlackApiException { Error: "invalid_auth" or "token_revoked" or "account_inactive" } => "Slack refused the user token; reconnect in Settings › Integrations.",
        SlackApiException { Error: "missing_scope" } => "The Slack app is missing a scope; reinstall it from the CodeChroma manifest.",
        SlackApiException slack => slack.Message,
        HttpRequestException http => "Slack is unreachable: " + http.Message,
        _ => error.Message,
    };
}
