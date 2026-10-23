using System.Diagnostics;
using System.Text;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Routes;

/// <summary>The in-app "Create issue": reports whether `gh` can post, and posts through it when it can.</summary>
public static class IssueRoutes
{
    public const string IssueRepo = "gutzerk/code_chroma";
    private const int GhTimeoutSeconds = 60;
    private static readonly TimeSpan ReadyTtl = TimeSpan.FromSeconds(60);
    private static readonly HashSet<string> AllowedLabels = ["bug", "enhancement", "question", "documentation"];
    private static (DateTime At, bool Ready)? _ready;

    public static void Map(WebApplication app)
    {
        app.MapGet("/issues/status", () => Reply.Json(new System.Text.Json.Nodes.JsonObject { ["repo"] = IssueRepo, ["can_post"] = GhReady() }));

        app.MapPost("/issues", async (HttpRequest request) =>
        {
            var payload = await Reply.LenientBody(request);
            var title = (payload["title"]?.ToString() ?? "").Trim();
            var label = payload.ContainsKey("label") ? payload["label"]?.ToString() ?? "None" : "bug";
            if (title.Length == 0) return Reply.Error(400, "title is required");
            if (!AllowedLabels.Contains(label)) return Reply.Error(400, $"unknown label: {label}");
            if (!GhReady()) return Reply.Error(409, "GitHub CLI is missing or not logged in");
            var output = Gh(["issue", "create", "--repo", IssueRepo, "--title", title, "--body", payload["body"]?.ToString() ?? "", "--label", label], out var error);
            var url = FirstUrl(output ?? "");
            return url is null
                ? Reply.Error(502, $"gh issue create failed: {(string.IsNullOrWhiteSpace(error) ? "no output from gh" : error.Trim())}")
                : Reply.Json(new System.Text.Json.Nodes.JsonObject { ["url"] = url });
        });
    }

    public static string? FirstUrl(string output) =>
        output.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.StartsWith("http", StringComparison.Ordinal));

    private static bool GhReady()
    {
        if (_ready is { } cached && DateTime.UtcNow - cached.At < ReadyTtl) return cached.Ready;
        var ready = CliLocator.Find("gh") is not null && Gh(["auth", "status"], out _) is not null;
        _ready = (DateTime.UtcNow, ready);
        return ready;
    }

    /// <summary>`gh` in the home directory; null when it is missing, fails, or hangs.</summary>
    private static string? Gh(string[] args, out string error)
    {
        error = "";
        var info = new ProcessStartInfo(CliLocator.Find("gh") ?? "gh")
        {
            WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            StandardOutputEncoding = Encoding.UTF8,
        };
        info.Environment["GH_PROMPT_DISABLED"] = "1";
        foreach (var arg in args) info.ArgumentList.Add(arg);
        try
        {
            using var process = Process.Start(info)!;
            process.StandardInput.Close();
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(TimeSpan.FromSeconds(GhTimeoutSeconds)))
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                error = "gh timed out";
                return null;
            }
            error = stderr.GetAwaiter().GetResult();
            return process.ExitCode == 0 ? stdout.GetAwaiter().GetResult() : null;
        }
        catch (System.ComponentModel.Win32Exception e)
        {
            error = e.Message;
            return null;
        }
    }
}
