using System.Text.Json;
using System.Text.RegularExpressions;

namespace CodeChroma.Shell;

public enum UpdatePhase { Idle, Checking, UpToDate, Available, Downloading, Ready, Installing, Error }

public sealed record UpdateState(
    string CurrentVersion,
    string? LatestVersion = null,
    UpdatePhase Phase = UpdatePhase.Idle,
    long? Bytes = null,
    long? Total = null,
    string? Error = null,
    DateTimeOffset? RetryAfter = null,
    string? Notes = null);

public interface IUpdateOperations
{
    Task<UpdateInfo?> CheckAsync(string currentVersion, Action<string>? onLatest, CancellationToken ct);

    Task DownloadAsync(UpdateInfo info, Action<long, long?> progress, CancellationToken ct);

    Task<bool> InstallAsync(UpdateInfo info, CancellationToken ct);

    void AssertWritable();
}

public interface IUpdateCache
{
    string? Read();

    void Write(string version);
}

public sealed partial class FileUpdateCache(string path) : IUpdateCache
{
    public static string PathIn(string userDataDir) => Path.Combine(userDataDir, "update-cache.json");

    [GeneratedRegex(@"^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")]
    private static partial Regex VersionPattern();

    public string? Read()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (doc.RootElement.ValueKind != JsonValueKind.Object
                || !doc.RootElement.TryGetProperty("latestVersion", out var v) || v.ValueKind != JsonValueKind.String) return null;
            var version = v.GetString();
            return version is not null && VersionPattern().IsMatch(version) ? version : null;
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public void Write(string version)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(new { latestVersion = version }));
    }
}

/// <summary>One shared update transaction for settings, the menu and notifications.</summary>
public sealed partial class UpdateService
{
    private readonly IUpdateOperations ops;
    private readonly IUpdateCache cache;
    private readonly Action<UpdateState> changed;
    private readonly Func<DateTimeOffset> clock;
    private UpdateInfo? info;
    private bool busy;

    public UpdateState State { get; private set; }

    public UpdateService(string currentVersion, IUpdateOperations ops, IUpdateCache cache, Action<UpdateState> changed, Func<DateTimeOffset>? clock = null)
    {
        this.ops = ops;
        this.cache = cache;
        this.changed = changed;
        this.clock = clock ?? (() => DateTimeOffset.UtcNow);
        State = new UpdateState(currentVersion, cache.Read());
    }

    [GeneratedRegex(@"root was signed by (\d+)/(\d+) keys", RegexOptions.IgnoreCase)]
    private static partial Regex SignatureFailure();

    private void Set(Func<UpdateState, UpdateState> patch)
    {
        State = patch(State);
        changed(State);
    }

    private async Task<UpdateState> Run(Func<Task> action)
    {
        if (busy) return State;
        busy = true;
        try
        {
            await action();
        }
        catch (Exception error)
        {
            var rateLimit = error as GitHubRateLimitException;
            var signature = SignatureFailure().Match(error.Message);
            Set(s => s with
            {
                Phase = UpdatePhase.Error,
                Error = rateLimit is not null ? error.Message
                    : signature.Success ? $"Release signature could not be verified ({signature.Groups[1].Value}/{signature.Groups[2].Value} keys). The release may be unsigned or signed with outdated keys. Update manually from GitHub Releases."
                    : $"{error.Message} Try again or update manually from GitHub Releases.",
                RetryAfter = rateLimit?.RetryAt,
            });
        }
        finally
        {
            busy = false;
        }
        return State;
    }

    public Task<UpdateState> CheckAsync(CancellationToken ct = default) => Run(async () =>
    {
        if (State.RetryAfter is { } retryAfter && clock() < retryAfter) return;
        if (State.Phase == UpdatePhase.Ready) return;
        info = null;
        Set(s => s with { Phase = UpdatePhase.Checking, Error = null });
        var latestReturned = false;
        info = await ops.CheckAsync(State.CurrentVersion, latest =>
        {
            latestReturned = true;
            try { cache.Write(latest); } catch (IOException) { }
            Set(s => s with { LatestVersion = latest });
        }, ct);
        if (!latestReturned && info is null) throw new InvalidOperationException("No stable release was returned by GitHub.");
        Set(s => s with
        {
            Phase = info is null ? UpdatePhase.UpToDate : UpdatePhase.Available,
            LatestVersion = info?.Version ?? s.LatestVersion,
            RetryAfter = null,
            Notes = info?.Notes,
        });
    });

    public Task<UpdateState> DownloadAsync(CancellationToken ct = default) => Run(async () =>
    {
        if (State.Phase == UpdatePhase.Ready) return;
        var update = info ?? throw new InvalidOperationException("Check for updates first.");
        ops.AssertWritable();
        Set(s => s with { Phase = UpdatePhase.Downloading, Bytes = 0, Total = null, Error = null });
        await ops.DownloadAsync(update, (bytes, total) => Set(s => s with { Bytes = bytes, Total = total }), ct);
        Set(s => s with { Phase = UpdatePhase.Ready });
    });

    public Task<UpdateState> RestartAsync(Action<bool> restartApp, CancellationToken ct = default) => Run(async () =>
    {
        if (State.Phase != UpdatePhase.Ready || info is null) throw new InvalidOperationException("Download the update first.");
        Set(s => s with { Phase = UpdatePhase.Installing, Error = null });
        restartApp(await ops.InstallAsync(info, ct));
    });
}
