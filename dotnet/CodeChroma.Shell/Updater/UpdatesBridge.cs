using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodeChroma.Shell;

/// <summary>The shell side of window.codechromaUpdates: maps the page's calls onto UpdateService and pushes every state change back as JSON.</summary>
public sealed class UpdatesBridge(UpdateService service, Func<UpdateSettings> readSettings, Action<UpdateSettings> writeSettings, Action<bool> restartApp, Action<string> push)
{
    private static readonly JsonSerializerOptions Options = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    public static string ToJson(UpdateState state, UpdateSettings settings) => JsonSerializer.Serialize(new
    {
        currentVersion = state.CurrentVersion,
        latestVersion = state.LatestVersion,
        phase = PhaseName(state.Phase),
        bytes = state.Bytes,
        total = state.Total,
        error = state.Error,
        retryAfter = state.RetryAfter?.ToUnixTimeMilliseconds(),
        notes = state.Notes,
        skippedVersion = settings.SkippedVersion,
        autoDownload = settings.AutoDownload,
        verificationNotice = state.VerificationNotice,
        provenance = state.Provenance?.ToString(),
        lastInstall = state.LastInstall,
    }, Options);

    private static string PhaseName(UpdatePhase phase) => phase switch
    {
        UpdatePhase.UpToDate => "up-to-date",
        _ => phase.ToString().ToLowerInvariant(),
    };

    /// <summary>Sends the current state to the page; also the UpdateService change callback.</summary>
    public void Push() => push(ToJson(service.State, readSettings()));

    public async Task<string> InvokeAsync(string method, string? arg)
    {
        switch (method)
        {
            case "state": break;
            case "check": await service.CheckAsync(); break;
            case "download": await service.DownloadAsync(); break;
            case "restart": await service.RestartAsync(restartApp); break;
            case "skip": writeSettings(readSettings() with { SkippedVersion = arg ?? service.State.LatestVersion }); break;
            case "auto-download": writeSettings(readSettings() with { AutoDownload = arg == "true" }); break;
            default: throw new ArgumentException($"unknown update method: {method}", nameof(method));
        }
        return ToJson(service.State, readSettings());
    }
}
