using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Messages;

/// <summary>Owns the connected sources: starts them from the vault, connects/disconnects them, and fans focus re-checks out.</summary>
public sealed class MessagesService : IHostedService, IAsyncDisposable
{
    public const string DefaultTenant = "common";

    private sealed record Pending(string ClientId, string Tenant, string Verifier, string RedirectUri, DateTimeOffset Created);

    private sealed class Runner(IMessageSource source, CancellationTokenSource stop, Task task)
    {
        public IMessageSource Source { get; } = source;
        public CancellationTokenSource Stop { get; } = stop;
        public Task Task { get; } = task;
    }

    private readonly ITokenVault _vault;
    private readonly MessagesOptions _options;
    private readonly TimeProvider _clock;
    private readonly HttpClient _http;
    private readonly ConcurrentDictionary<string, Pending> _pending = new();
    private readonly Dictionary<string, Runner> _runners = [];
    private readonly object _gate = new();
    private DateTimeOffset _lastFocus = DateTimeOffset.MinValue;
    private SlackIdentity? _slackIdentity;

    public UnreadFeed Feed { get; }

    public MessagesService(ITokenVault vault, MessagesOptions options, TimeProvider clock, ConnectionManager connections)
    {
        _vault = vault;
        _options = options;
        _clock = clock;
        _http = options.Handler is { } handler ? new HttpClient(handler, disposeHandler: false) : new HttpClient();
        _http.Timeout = TimeSpan.FromSeconds(30);
        Feed = new UnreadFeed(() => connections.BroadcastDetached(new JsonObject { ["type"] = "messages-changed" }));
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_options.AutoStart) return Task.CompletedTask;
        try
        {
            if (_vault.Get(VaultKeys.SlackUserToken) is { } user && _vault.Get(VaultKeys.SlackAppToken) is { } app) StartSlack(user, app);
            if (_vault.Get(VaultKeys.OutlookRefreshToken) is { } refresh)
                StartOutlook(_vault.Get(VaultKeys.OutlookClientId) ?? _options.DefaultOutlookClientId ?? "", _vault.Get(VaultKeys.OutlookTenant) ?? DefaultTenant, refresh);
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            foreach (var source in UnreadFeed.Sources) Feed.Fail(source, "Could not read saved tokens: " + error.Message);
        }
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        foreach (var source in UnreadFeed.Sources) await StopSourceAsync(source);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync(CancellationToken.None);
        _http.Dispose();
    }

    /// <summary>Validates both Slack tokens against Slack, saves them, and (re)starts the source.</summary>
    public async Task<SlackIdentity> ConnectSlackAsync(string userToken, string appToken, CancellationToken cancel)
    {
        userToken = userToken.Trim();
        appToken = appToken.Trim();
        if (!userToken.StartsWith("xoxp-", StringComparison.Ordinal)) throw new IntegrationException("The user token must start with xoxp-.");
        if (!appToken.StartsWith("xapp-", StringComparison.Ordinal)) throw new IntegrationException("The app-level token must start with xapp-.");
        var api = new SlackApi(_http, _options.SlackApi, userToken, appToken);
        SlackIdentity identity;
        try
        {
            identity = await new SlackSource(api, _options, _clock).IdentifyAsync(cancel);
            await api.Call("apps.connections.open", useAppToken: true, cancel: cancel);
        }
        catch (SlackApiException error) { throw new IntegrationException("Slack refused the tokens: " + error.Error); }
        catch (HttpRequestException error) { throw new IntegrationException("Slack is unreachable: " + error.Message, 502); }
        await StopSourceAsync(SlackSource.SourceName);
        _vault.Set(VaultKeys.SlackUserToken, userToken);
        _vault.Set(VaultKeys.SlackAppToken, appToken);
        StartSlack(userToken, appToken);
        return identity;
    }

    /// <summary>Starts the PKCE sign-in and returns the browser URL; the callback finishes it.</summary>
    public Uri BeginOutlook(string? clientId, string? tenant, string redirectUri)
    {
        var effectiveClient = clientId is { Length: > 0 } own ? own.Trim() : _options.DefaultOutlookClientId
            ?? throw new IntegrationException("This build has no CodeChroma Entra client id yet; enter your own application (client) id.");
        var effectiveTenant = tenant is { Length: > 0 } t ? t.Trim() : DefaultTenant;
        foreach (var stale in _pending.Where(p => _clock.GetUtcNow() - p.Value.Created > TimeSpan.FromMinutes(10)).ToList()) _pending.TryRemove(stale.Key, out _);
        var (verifier, challenge) = OutlookAuth.Pkce();
        var state = OutlookAuth.NewState();
        _pending[state] = new Pending(effectiveClient, effectiveTenant, verifier, redirectUri, _clock.GetUtcNow());
        return Auth().AuthorizeUrl(effectiveClient, effectiveTenant, redirectUri, state, challenge);
    }

    /// <summary>Exchanges the callback's code, saves the refresh token, and starts polling.</summary>
    public async Task CompleteOutlookAsync(string? state, string? code, string? error, CancellationToken cancel)
    {
        if (state is null || !_pending.TryRemove(state, out var pending)) throw new IntegrationException("This sign-in link expired; start again from Settings › Integrations.");
        if (error is { Length: > 0 }) throw new IntegrationException("Microsoft sign-in was cancelled or refused: " + error);
        if (code is not { Length: > 0 }) throw new IntegrationException("Microsoft sign-in returned no code.");
        var tokens = await Auth().ExchangeAsync(pending.ClientId, pending.Tenant, code, pending.Verifier, pending.RedirectUri, cancel);
        if (tokens.RefreshToken is not { Length: > 0 } refresh) throw new IntegrationException("Microsoft returned no refresh token (offline_access was not granted).");
        await StopSourceAsync(OutlookSource.SourceName);
        _vault.Set(VaultKeys.OutlookRefreshToken, refresh);
        if (pending.ClientId != _options.DefaultOutlookClientId) _vault.Set(VaultKeys.OutlookClientId, pending.ClientId);
        else _vault.Delete(VaultKeys.OutlookClientId);
        if (pending.Tenant != DefaultTenant) _vault.Set(VaultKeys.OutlookTenant, pending.Tenant);
        else _vault.Delete(VaultKeys.OutlookTenant);
        StartOutlook(pending.ClientId, pending.Tenant, refresh);
    }

    public async Task DisconnectAsync(string source)
    {
        if (!UnreadFeed.Sources.Contains(source)) throw new IntegrationException($"unknown source: {source}", 404);
        await StopSourceAsync(source);
        foreach (var key in source == SlackSource.SourceName ? VaultKeys.Slack : VaultKeys.Outlook) _vault.Delete(key);
        if (source == SlackSource.SourceName) _slackIdentity = null;
        Feed.Clear(source);
    }

    /// <summary>A window-focus re-check of every running source, throttled; false when it was skipped.</summary>
    public bool RefreshAll()
    {
        List<Runner> runners;
        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            if (now - _lastFocus < _options.FocusThrottle) return false;
            _lastFocus = now;
            runners = [.. _runners.Values];
        }
        foreach (var runner in runners)
            _ = Task.Run(async () =>
            {
                try { await runner.Source.RecheckAsync(Feed, runner.Stop.Token); }
                catch (OperationCanceledException) { }
                catch (Exception error) { Feed.Fail(runner.Source.Name, error is SlackApiException ? SlackSource.Describe(error) : error.Message); }
            });
        return true;
    }

    /// <summary>The GET /integrations body: per-source connection, account and the token storage in use.</summary>
    public JsonObject Status()
    {
        var (slackState, slackError) = Feed.StateOf(SlackSource.SourceName);
        var (outlookState, outlookError) = Feed.StateOf(OutlookSource.SourceName);
        OutlookSource? outlook;
        lock (_gate) outlook = _runners.GetValueOrDefault(OutlookSource.SourceName)?.Source as OutlookSource;
        string? customClient = null;
        string? tenant = null;
        try
        {
            customClient = _vault.Get(VaultKeys.OutlookClientId);
            tenant = _vault.Get(VaultKeys.OutlookTenant);
        }
        catch (Exception error) when (error is IOException or InvalidOperationException) { }
        return new JsonObject
        {
            ["slack"] = new JsonObject
            {
                ["connected"] = IsRunning(SlackSource.SourceName), ["state"] = slackState, ["error"] = slackError,
                ["workspace"] = _slackIdentity?.Team, ["user"] = _slackIdentity?.User,
            },
            ["outlook"] = new JsonObject
            {
                ["connected"] = IsRunning(OutlookSource.SourceName), ["state"] = outlookState, ["error"] = outlookError,
                ["account"] = outlook?.Account, ["client_id"] = customClient, ["tenant"] = tenant ?? DefaultTenant,
                ["default_client_available"] = _options.DefaultOutlookClientId is not null,
            },
            ["token_storage"] = new JsonObject { ["backend"] = _vault.Backend, ["warning"] = _vault.Warning },
        };
    }

    private bool IsRunning(string source)
    {
        lock (_gate) return _runners.ContainsKey(source);
    }

    private OutlookAuth Auth() => new(_http, _options.Login, _clock);

    private void StartSlack(string userToken, string appToken)
    {
        var source = new SlackSource(new SlackApi(_http, _options.SlackApi, userToken, appToken), _options, _clock);
        Start(source, async stop =>
        {
            try { _slackIdentity = await source.IdentifyAsync(stop); }
            catch (Exception) { /* RunAsync reports it */ }
            await source.RunAsync(Feed, stop);
        });
    }

    private void StartOutlook(string clientId, string tenant, string refreshToken)
    {
        if (clientId.Length == 0)
        {
            Feed.Fail(OutlookSource.SourceName, "No Entra client id is configured; connect again with your own client id.");
            return;
        }
        var source = new OutlookSource(_http, Auth(), _options, _clock, clientId, tenant, refreshToken, rotated =>
        {
            try { _vault.Set(VaultKeys.OutlookRefreshToken, rotated); }
            catch (Exception error) when (error is IOException or InvalidOperationException) { }
        });
        Start(source, stop => source.RunAsync(Feed, stop));
    }

    private void Start(IMessageSource source, Func<CancellationToken, Task> run)
    {
        var stop = new CancellationTokenSource();
        Feed.Connecting(source.Name);
        var task = Task.Run(async () =>
        {
            try { await run(stop.Token); }
            catch (OperationCanceledException) { }
            catch (Exception error) { Feed.Fail(source.Name, error.Message); }
        });
        lock (_gate) _runners[source.Name] = new Runner(source, stop, task);
    }

    private async Task StopSourceAsync(string name)
    {
        Runner? runner;
        lock (_gate)
        {
            if (!_runners.Remove(name, out runner)) return;
        }
        await runner.Stop.CancelAsync();
        try { await runner.Task.WaitAsync(TimeSpan.FromSeconds(5)); }
        catch (Exception) { /* a source that will not stop in time is abandoned */ }
        runner.Stop.Dispose();
    }
}

/// <summary>DI wiring for the messages feature.</summary>
public static class MessagesRegistration
{
    public static IServiceCollection AddMessages(this IServiceCollection services)
    {
        services.AddSingleton(_ => new MessagesOptions());
        services.AddSingleton<ITokenVault>(sp => TokenVault.ForPlatform(sp.GetRequiredService<UserPaths>().IntegrationTokens));
        services.AddSingleton<MessagesService>();
        services.AddHostedService(sp => sp.GetRequiredService<MessagesService>());
        return services;
    }
}
