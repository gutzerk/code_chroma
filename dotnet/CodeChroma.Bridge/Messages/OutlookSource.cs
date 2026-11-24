using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Messages;

/// <summary>An Entra token response; only the refresh token is ever persisted.</summary>
public sealed record OutlookTokens(string AccessToken, string? RefreshToken, DateTimeOffset ExpiresAt);

/// <summary>Microsoft identity platform auth code + PKCE for a public client (no secret).</summary>
public sealed class OutlookAuth(HttpClient http, Uri login, TimeProvider clock)
{
    public const string Scopes = "offline_access User.Read Mail.Read";

    /// <summary>A fresh PKCE verifier and its S256 challenge.</summary>
    public static (string Verifier, string Challenge) Pkce()
    {
        var verifier = Base64Url(RandomNumberGenerator.GetBytes(32));
        return (verifier, Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))));
    }

    public static string NewState() => Base64Url(RandomNumberGenerator.GetBytes(16));

    public Uri AuthorizeUrl(string clientId, string tenant, string redirectUri, string state, string challenge)
    {
        var query = string.Join('&', new Dictionary<string, string>
        {
            ["client_id"] = clientId, ["response_type"] = "code", ["redirect_uri"] = redirectUri, ["response_mode"] = "query",
            ["scope"] = Scopes, ["state"] = state, ["code_challenge"] = challenge, ["code_challenge_method"] = "S256", ["prompt"] = "select_account",
        }.Select(p => $"{p.Key}={Uri.EscapeDataString(p.Value)}"));
        return new Uri(login, $"{Uri.EscapeDataString(tenant)}/oauth2/v2.0/authorize?{query}");
    }

    public Task<OutlookTokens> ExchangeAsync(string clientId, string tenant, string code, string verifier, string redirectUri, CancellationToken cancel) =>
        TokenAsync(tenant, new Dictionary<string, string>
        {
            ["client_id"] = clientId, ["grant_type"] = "authorization_code", ["code"] = code, ["redirect_uri"] = redirectUri,
            ["code_verifier"] = verifier, ["scope"] = Scopes,
        }, cancel);

    public Task<OutlookTokens> RefreshAsync(string clientId, string tenant, string refreshToken, CancellationToken cancel) =>
        TokenAsync(tenant, new Dictionary<string, string>
        {
            ["client_id"] = clientId, ["grant_type"] = "refresh_token", ["refresh_token"] = refreshToken, ["scope"] = Scopes,
        }, cancel);

    private async Task<OutlookTokens> TokenAsync(string tenant, Dictionary<string, string> form, CancellationToken cancel)
    {
        using var response = await http.PostAsync(new Uri(login, $"{Uri.EscapeDataString(tenant)}/oauth2/v2.0/token"), new FormUrlEncodedContent(form), cancel);
        var body = await ParseAsync(response, cancel);
        if (!response.IsSuccessStatusCode || Json.Str(body["access_token"]) is not { } access)
        {
            var error = Json.Str(body["error"]) ?? $"http_{(int)response.StatusCode}";
            var description = Json.Str(body["error_description"])?.Split('\n')[0].Trim();
            throw new IntegrationException(error == "invalid_grant"
                ? "Outlook sign-in expired or was revoked; connect again in Settings › Integrations."
                : $"Microsoft sign-in failed: {error}{(description is { Length: > 0 } ? " — " + description : "")}", 401);
        }
        var seconds = body["expires_in"] is JsonValue value && value.TryGetValue(out int s) ? s : 3600;
        return new OutlookTokens(access, Json.Str(body["refresh_token"]), clock.GetUtcNow().AddSeconds(seconds - 60));
    }

    internal static async Task<JsonObject> ParseAsync(HttpResponseMessage response, CancellationToken cancel)
    {
        try { return JsonNode.Parse(await response.Content.ReadAsStringAsync(cancel)) as JsonObject ?? []; }
        catch (JsonException) { return []; }
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>Unread Outlook mail: one Graph query over every folder (minus Junk and Deleted Items), polled.</summary>
public sealed class OutlookSource(
    HttpClient http, OutlookAuth auth, MessagesOptions options, TimeProvider clock,
    string clientId, string tenant, string refreshToken, Action<string> saveRefreshToken) : IMessageSource
{
    public const string SourceName = "outlook";

    private static readonly string[] HiddenFolders = ["junkemail", "deleteditems"];

    private readonly SemaphoreSlim _tokenGate = new(1, 1);
    private OutlookTokens? _tokens;
    private string _refreshToken = refreshToken;
    private static readonly TimeSpan FolderRefresh = TimeSpan.FromMinutes(15);
    private const int MaxFolders = 2000;

    private HashSet<string>? _hiddenFolderIds;
    private Dictionary<string, string> _folderNames = [];
    private DateTimeOffset _foldersLoadedAt;

    public string Name => SourceName;

    /// <summary>The signed-in mailbox (shown in Settings; kept in memory only).</summary>
    public string? Account { get; private set; }

    public async Task RecheckAsync(UnreadFeed feed, CancellationToken cancel)
    {
        if (Account is null)
        {
            var me = await GetAsync("me?$select=mail,userPrincipalName", cancel);
            Account = Json.NonEmptyStr(me["mail"]) ?? Json.Str(me["userPrincipalName"]);
        }
        if (_hiddenFolderIds is null || clock.GetUtcNow() - _foldersLoadedAt >= FolderRefresh) await LoadFoldersAsync(cancel);
        var items = new List<UnreadItem>();
        string? next = "me/messages?$filter=isRead%20eq%20false&$select=id,subject,bodyPreview,from,receivedDateTime,webLink,parentFolderId&$top=100";
        while (next is not null && items.Count < options.OutlookMaxItems)
        {
            var page = await GetAsync(next, cancel);
            foreach (var node in page["value"]?.AsArray() ?? [])
                if (node is JsonObject message && ToItem(message) is { } item) items.Add(item);
            next = Json.Str(page["@odata.nextLink"]);
        }
        feed.Replace(SourceName, items.Take(options.OutlookMaxItems), clock.GetUtcNow());
    }

    public async Task RunAsync(UnreadFeed feed, CancellationToken stop)
    {
        feed.Connecting(SourceName);
        while (!stop.IsCancellationRequested)
        {
            try { await RecheckAsync(feed, stop); }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (Exception error) { feed.Fail(SourceName, Describe(error)); }
            try { await Task.Delay(options.OutlookPoll, clock, stop); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task LoadFoldersAsync(CancellationToken cancel)
    {
        var hidden = new HashSet<string>();
        foreach (var wellKnown in HiddenFolders)
        {
            try { if (Json.Str((await GetAsync($"me/mailFolders/{wellKnown}?$select=id", cancel))["id"]) is { } id) hidden.Add(id); }
            catch (GraphException error) when (error.Status == HttpStatusCode.NotFound) { }
        }
        var names = new Dictionary<string, string>();
        var pending = new Queue<(string Path, bool Hidden)>();
        pending.Enqueue(("me/mailFolders", false));
        while (pending.Count > 0 && names.Count < MaxFolders)
        {
            var (path, parentHidden) = pending.Dequeue();
            string? next = $"{path}?$select=id,displayName,childFolderCount&$top=100";
            while (next is not null && names.Count < MaxFolders)
            {
                var page = await GetAsync(next, cancel);
                foreach (var node in page["value"]?.AsArray() ?? [])
                {
                    if (Json.Str(node?["id"]) is not { } id) continue;
                    names[id] = Json.Str(node?["displayName"]) ?? "Mail";
                    var isHidden = parentHidden || hidden.Contains(id);
                    if (isHidden) hidden.Add(id);
                    if (node?["childFolderCount"] is JsonValue count && count.TryGetValue(out int children) && children > 0)
                        pending.Enqueue(($"me/mailFolders/{Uri.EscapeDataString(id)}/childFolders", isHidden));
                }
                next = Json.Str(page["@odata.nextLink"]);
            }
        }
        _folderNames = names;
        _hiddenFolderIds = hidden;
        _foldersLoadedAt = clock.GetUtcNow();
    }

    private UnreadItem? ToItem(JsonObject message)
    {
        if (Json.Str(message["id"]) is not { } id || Json.Str(message["webLink"]) is not { } link) return null;
        var folder = Json.Str(message["parentFolderId"]) ?? "";
        if (_hiddenFolderIds?.Contains(folder) == true) return null;
        var address = message["from"]?["emailAddress"];
        var subject = Json.NonEmptyStr(message["subject"]) ?? "(no subject)";
        var body = Regex.Replace(Json.Str(message["bodyPreview"]) ?? "", "\\s+", " ").Trim();
        var preview = body.Length > 0 ? $"{subject} — {body}" : subject;
        var at = DateTimeOffset.TryParse(Json.Str(message["receivedDateTime"]), System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal, out var received) ? received : DateTimeOffset.UnixEpoch;
        return new UnreadItem(
            $"outlook:{id}", SourceName, _folderNames.GetValueOrDefault(folder, "Mail"),
            Json.NonEmptyStr(address?["name"]) ?? Json.Str(address?["address"]) ?? "Unknown sender",
            preview.Length > 200 ? preview[..199] + "…" : preview, at.ToUniversalTime(), link, null, folder);
    }

    private async Task<JsonObject> GetAsync(string pathOrUrl, CancellationToken cancel)
    {
        var url = Uri.TryCreate(pathOrUrl, UriKind.Absolute, out var absolute) && absolute.Scheme.StartsWith("http", StringComparison.Ordinal)
            ? absolute : new Uri(options.GraphApi, pathOrUrl);
        for (var attempt = 0; ; attempt++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await AccessTokenAsync(force: attempt > 0, cancel));
            using var response = await http.SendAsync(request, cancel);
            if (response.StatusCode == HttpStatusCode.Unauthorized && attempt == 0) continue;
            if (response.StatusCode == HttpStatusCode.TooManyRequests && attempt < 3)
            {
                await Task.Delay(response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(5), cancel);
                continue;
            }
            var body = await OutlookAuth.ParseAsync(response, cancel);
            if (!response.IsSuccessStatusCode) throw new GraphException(response.StatusCode, Json.Str(body["error"]?["message"]) ?? $"http {(int)response.StatusCode}");
            return body;
        }
    }

    private async Task<string> AccessTokenAsync(bool force, CancellationToken cancel)
    {
        await _tokenGate.WaitAsync(cancel);
        try
        {
            if (!force && _tokens is { } current && current.ExpiresAt > clock.GetUtcNow()) return current.AccessToken;
            _tokens = await auth.RefreshAsync(clientId, tenant, _refreshToken, cancel);
            if (_tokens.RefreshToken is { Length: > 0 } rotated && rotated != _refreshToken)
            {
                _refreshToken = rotated;
                saveRefreshToken(rotated);
            }
            return _tokens.AccessToken;
        }
        finally { _tokenGate.Release(); }
    }

    private static string Describe(Exception error) => error switch
    {
        IntegrationException integration => integration.Message,
        GraphException graph => "Outlook: " + graph.Message,
        HttpRequestException http => "Outlook is unreachable: " + http.Message,
        _ => error.Message,
    };
}

public sealed class GraphException(HttpStatusCode status, string message) : Exception(message)
{
    public HttpStatusCode Status { get; } = status;
}
