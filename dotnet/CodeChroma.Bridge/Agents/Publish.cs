using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Agents;

/// <summary>
/// Handing an agent's work off: `git push` plus `gh pr create`, with every blocker checked first. The button on the card is
/// disabled with its reason as the label, so every check here runs before the UI renders anything. Uncommitted edits are a
/// separate case, not a blocker: the UI requires an explicit choice (commit them, or publish without them). There is deliberately
/// no local merge into the main branch; merging is delegated to GitHub via the PR.
/// </summary>
public static class Publish
{
    public const string ReasonGhMissing = "gh-missing";
    public const string ReasonNotAuthenticated = "not-authenticated";
    public const string ReasonNotGithub = "not-github";
    public const string ReasonNoCommits = "no-commits";
    public const string ReasonExists = "pr-exists";
    public const string ReasonPrAttached = "pr-attached";

    private const string FallbackCommitMessage = "chore: agent work in progress";
    private const int MaxCommitMessageAttempts = 2;
    private const int DiffCharLimit = 20_000;
    private const int CommitMessageTimeoutSeconds = 30;

    /// <summary>What the disabled button says for each blocker; the UI shows this verbatim.</summary>
    public static readonly IReadOnlyDictionary<string, string> ButtonText = new Dictionary<string, string>
    {
        [ReasonGhMissing] = "GitHub CLI required",
        [ReasonNotAuthenticated] = "Log in: gh auth login",
        [ReasonNotGithub] = "Could not detect a GitHub repository; check that `gh repo view` works here",
        [ReasonNoCommits] = "The agent hasn't committed anything yet",
        [ReasonPrAttached] = "Reviewing a PR -- can't publish from here",
    };

    /// <summary>Everything that would stop a PR, checked before the button renders, not after a click.</summary>
    public static JsonObject Preflight(string worktree, string branch, string mainBranch, string? sourcePr = null)
    {
        if (sourcePr is not null) return Blocked(ReasonPrAttached);
        if (!Gh.Available) return Blocked(ReasonGhMissing);
        if (Gh.Run(worktree, "auth", "status") is null) return Blocked(ReasonNotAuthenticated);
        var remote = GitRunner.Run(worktree, "remote", "get-url", "origin");
        if (remote is null || !GithubCli.IsGithubRepository(worktree))
            return Blocked(ReasonNotGithub, new JsonObject { ["remote"] = remote?.Trim() });
        var existing = ExistingPrUrl(worktree, branch);
        if (existing is not null)
            return new JsonObject { ["ready"] = false, ["reason"] = ReasonExists, ["pr_url"] = existing, ["dirty"] = new JsonArray() };
        if (!CommitsAhead(worktree, branch, mainBranch)) return Blocked(ReasonNoCommits);
        return new JsonObject { ["ready"] = true, ["reason"] = null, ["pr_url"] = null, ["dirty"] = Strings(DirtyFiles(worktree)) };
    }

    /// <summary>Uncommitted paths a push would leave behind; the UI must not let these go unnoticed.</summary>
    public static List<string> DirtyFiles(string worktree)
    {
        var raw = GitRunner.Run(worktree, "status", "--porcelain", "--untracked-files=all");
        return GitRunner.PorcelainPaths(raw ?? "").Order(StringComparer.Ordinal).ToList();
    }

    /// <summary>The PR already open for this branch, so a second click links to it, not duplicates it.</summary>
    public static string? ExistingPrUrl(string worktree, string branch)
    {
        var result = Gh.Run(worktree, "pr", "view", branch, "--json", "url", "--jq", ".url")?.Trim();
        return result is not null && result.StartsWith("http", StringComparison.Ordinal) ? result : null;
    }

    /// <summary>Optionally commits the tree, pushes the branch, opens the PR; returns its URL.</summary>
    public static string CreatePr(string worktree, string branch, string mainBranch, bool commitDirty = false, string? sourcePr = null, UserPaths? paths = null)
    {
        if (sourcePr is not null) throw new PublishException($"agent is attached to {sourcePr}'s own branch -- cannot publish here");
        if (DirtyFiles(worktree).Count > 0 && commitDirty)
        {
            if (GitRunner.Run(worktree, "add", "-A") is null) throw new PublishException("git add -A failed in the agent's worktree");
            string? error = null;
            var committed = false;
            for (var attempt = 0; attempt < MaxCommitMessageAttempts && !committed; attempt++)
            {
                var message = GenerateCommitMessage(worktree, error, paths);
                var commit = GitRunner.RunRaw(worktree, "commit", "-m", message);
                if (commit is { ExitCode: 0 }) committed = true;
                else error = MessageOf(commit, "git commit failed");
            }
            if (!committed) throw new PublishException(error ?? "git commit failed");
        }
        try { GitLong.Run(worktree, "push", "-u", "origin", branch); }
        catch (GitLongException failure) { throw new PublishException(failure.Message); }
        var existing = ExistingPrUrl(worktree, branch);
        if (existing is not null) return existing;
        var created = Gh.Run(worktree, "pr", "create", "--fill", "--head", branch, "--base", mainBranch) ?? throw new PublishException("gh pr create failed");
        return FirstUrl(created) ?? throw new PublishException("gh pr create returned no URL");
    }

    /// <summary>Asks Claude for a message fitting the staged diff; a rejection is fed back for one retry.</summary>
    private static string GenerateCommitMessage(string worktree, string? previousError, UserPaths? paths)
    {
        string executable;
        try { executable = CliResolver.Resolve("claude", paths); }
        catch (CliLookupException) { return FallbackCommitMessage; }
        var diff = GitRunner.Run(worktree, "diff", "--cached") ?? "";
        if (diff.Length > DiffCharLimit) diff = diff[..DiffCharLimit] + "\n... (truncated)";
        var feedback = previousError is null ? "" :
            $"\n\nYour previous message was rejected by this repo's commit-msg hook: {previousError}\nWrite a different message that would pass it.\n";
        var prompt = "Write a single-line commit message for the following staged diff, following Conventional Commits "
            + "(type(scope): summary) unless the diff itself reveals a different convention this repo uses. "
            + $"Output ONLY the commit message text, nothing else — no quotes, no explanation.{feedback}\n\n{diff}";
        var info = new ProcessStartInfo(executable)
        {
            WorkingDirectory = worktree, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8,
        };
        foreach (var arg in new[] { "-p", prompt, "--model", "haiku" }) info.ArgumentList.Add(arg);
        try
        {
            using var process = Process.Start(info)!;
            var stdout = process.StandardOutput.ReadToEndAsync();
            _ = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(TimeSpan.FromSeconds(CommitMessageTimeoutSeconds)))
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                return FallbackCommitMessage;
            }
            if (process.ExitCode != 0) return FallbackCommitMessage;
            var first = stdout.GetAwaiter().GetResult().Split('\n').Select(l => l.Trim().Trim('"')).FirstOrDefault(l => l.Length > 0);
            return first ?? FallbackCommitMessage;
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return FallbackCommitMessage;
        }
    }

    public static string? FirstUrl(string output) =>
        output.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.StartsWith("http", StringComparison.Ordinal));

    private static JsonObject Blocked(string reason, JsonObject? extra = null)
    {
        var payload = new JsonObject { ["ready"] = false, ["reason"] = reason, ["text"] = ButtonText.GetValueOrDefault(reason), ["dirty"] = new JsonArray() };
        foreach (var (key, value) in extra ?? []) payload[key] = value?.DeepClone();
        return payload;
    }

    private static bool CommitsAhead(string worktree, string branch, string mainBranch) =>
        int.TryParse((GitRunner.Run(worktree, "rev-list", "--count", $"{mainBranch}..{branch}") ?? "0").Trim(), out var count) && count > 0;

    private static string MessageOf((int ExitCode, string Stdout, string Stderr)? result, string fallback)
    {
        if (result is null) return fallback;
        var text = (result.Value.Stderr.Length > 0 ? result.Value.Stderr : result.Value.Stdout).Trim();
        return text.Length > 0 ? text : fallback;
    }

    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
}
