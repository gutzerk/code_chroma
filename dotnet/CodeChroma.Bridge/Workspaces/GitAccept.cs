using System.Text;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Engine;

namespace CodeChroma.Bridge.Workspaces;

public sealed record AcceptResult(string FilePath, string CommitSha);

/// <summary>Commits one diffed node's change to git, staging only its overlapping hunks (git_accept.py).</summary>
public static partial class GitAccept
{
    private const string ComponentPrefix = "component::";

    [GeneratedRegex(@"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")]
    private static partial Regex HunkHeader();

    private sealed record Hunk(int OldStart, int NewStart, List<string> Lines);

    /// <summary>Commits nodeId's pending change: hunk-filtered for a present file, whole-file otherwise.</summary>
    public static AcceptResult Accept(IGraphEngine engine, string repoRoot, IOldSymbolParser parser, string nodeId)
    {
        var tree = GitTree.Detect(repoRoot) ?? throw new DiffNotFoundException("not a git repository");
        var filePath = FilePathFromNodeId(nodeId);
        var absolute = Path.Combine(tree.RepoRoot, filePath);
        var gitRelative = tree.GitRelative(filePath);

        if (!File.Exists(absolute) && !Directory.Exists(absolute))
            return AcceptWholeFile(tree, gitRelative, filePath, $"Accept deletion of {filePath}");
        if (!IsTracked(tree, gitRelative))
            return AcceptWholeFile(tree, gitRelative, filePath, $"Accept new file: {filePath}");

        // A node with no diff at all is the same 404 whichever check notices it, so look at git's diff first.
        var diffText = GitTree.Required(tree.GitRoot, ["diff", "HEAD", "--", gitRelative]);
        if (diffText.Trim().Length == 0) throw new DiffNotFoundException($"no pending change for {nodeId}");
        var (oldRange, newRange) = ResolveRanges(engine, tree, parser, nodeId, filePath);
        if (oldRange is null && newRange is null) throw new DiffNotFoundException($"no pending change for {nodeId}");

        var (header, hunks) = SplitDiff(diffText);
        var patch = BuildPatch(header, hunks, oldRange, newRange);
        if (patch is null) return AcceptWholeFile(tree, gitRelative, filePath, $"Accept diff: {filePath}");
        return new AcceptResult(filePath, CommitPatch(tree, gitRelative, patch, CommitMessage(nodeId, filePath)));
    }

    /// <summary>(old, new) line spans for the node, whichever side currently or previously existed.</summary>
    private static ((int, int)? Old, (int, int)? New) ResolveRanges(IGraphEngine engine, GitTree tree, IOldSymbolParser parser, string nodeId, string filePath)
    {
        (int, int)? newRange = engine.GetSymbol(nodeId) is { } symbol ? (symbol.StartLine, symbol.EndLine) : null;
        (int, int)? oldRange = null;
        if (FunctionDiffs.HasAnalyzer(filePath))
        {
            var old = FunctionDiffs.LoadOld(tree, parser, [filePath], "HEAD").GetValueOrDefault(filePath);
            var oldSymbol = old?.Functions.GetValueOrDefault(nodeId) ?? old?.Containers.GetValueOrDefault(nodeId);
            if (oldSymbol is not null) oldRange = (oldSymbol.StartLine, oldSymbol.EndLine);
        }
        return (oldRange, newRange);
    }

    /// <summary>The repo-relative file a node id refers to, across every id shape it emits.</summary>
    public static string FilePathFromNodeId(string nodeId) =>
        nodeId.StartsWith(ComponentPrefix, StringComparison.Ordinal) ? nodeId[ComponentPrefix.Length..] : nodeId.Split("::", 2)[0];

    private static bool IsTracked(GitTree tree, string gitRelative) =>
        (GitRunner.Run(tree.GitRoot, "ls-files", "--", gitRelative) ?? "").Trim().Length > 0;

    private static (List<string> Header, List<Hunk> Hunks) SplitDiff(string diffText)
    {
        var header = new List<string>();
        var hunks = new List<Hunk>();
        List<string>? current = null;
        foreach (var line in KeepEnds(diffText))
        {
            if (HunkHeader().IsMatch(line))
            {
                if (current is not null) hunks.Add(Finish(current));
                current = [line];
            }
            else if (current is not null) current.Add(line);
            else header.Add(line);
        }
        if (current is not null) hunks.Add(Finish(current));
        return (header, hunks);
    }

    private static IEnumerable<string> KeepEnds(string text)
    {
        var start = 0;
        while (start < text.Length)
        {
            var end = text.IndexOf('\n', start);
            var stop = end < 0 ? text.Length : end + 1;
            yield return text[start..stop];
            start = stop;
        }
    }

    private static Hunk Finish(List<string> lines)
    {
        var match = HunkHeader().Match(lines[0]);
        return new Hunk(int.Parse(match.Groups[1].Value), int.Parse(match.Groups[3].Value), lines);
    }

    /// <summary>Rewrites every hunk down to just this node's own lines; null if nothing of it survives.</summary>
    private static string? BuildPatch(List<string> header, List<Hunk> hunks, (int, int)? oldRange, (int, int)? newRange)
    {
        var body = new List<string>();
        foreach (var hunk in hunks)
            if (RewriteHunk(hunk, oldRange, newRange) is { } rewritten) body.AddRange(rewritten);
        return body.Count == 0 ? null : string.Concat(header.Concat(body));
    }

    /// <summary>Folds every +/- line outside the old/new range back to context; null if none remain.</summary>
    private static List<string>? RewriteHunk(Hunk hunk, (int, int)? oldRange, (int, int)? newRange)
    {
        var oldLine = hunk.OldStart;
        var newLine = hunk.NewStart;
        var output = new List<string> { hunk.Lines[0] };
        foreach (var raw in hunk.Lines.Skip(1))
        {
            var marker = raw.Length > 0 ? raw[0] : '\0';
            if (marker == '-')
            {
                if (oldRange is { } o && o.Item1 <= oldLine && oldLine <= o.Item2) output.Add(raw);
                else
                {
                    output.Add(" " + raw[1..]);
                    newLine++;
                }
                oldLine++;
            }
            else if (marker == '+')
            {
                if (newRange is { } n && n.Item1 <= newLine && newLine <= n.Item2) output.Add(raw);
                newLine++;
            }
            else
            {
                output.Add(raw);
                oldLine++;
                newLine++;
            }
        }
        return output.Skip(1).Any(line => line.Length > 0 && line[0] is '+' or '-') ? output : null;
    }

    private static string CommitMessage(string nodeId, string filePath) =>
        $"Accept diff: {(nodeId.Contains("::") ? nodeId[(nodeId.LastIndexOf("::", StringComparison.Ordinal) + 2)..] : nodeId)} ({filePath})";

    /// <summary>`git add` picks up creations, edits and deletions alike for an explicit pathspec.</summary>
    private static AcceptResult AcceptWholeFile(GitTree tree, string gitRelative, string filePath, string message)
    {
        GitTree.Required(tree.GitRoot, ["add", "--", gitRelative]);
        GitTree.Required(tree.GitRoot, ["commit", "-m", message, "--", gitRelative]);
        return new AcceptResult(filePath, GitTree.Required(tree.GitRoot, ["rev-parse", "HEAD"]).Trim());
    }

    /// <summary>Commits HEAD-plus-patch via a throwaway index, then syncs the real index's entry to it.</summary>
    private static string CommitPatch(GitTree tree, string gitRelative, string patch, string message)
    {
        var headSha = GitTree.Required(tree.GitRoot, ["rev-parse", "HEAD"]).Trim();
        var scratch = Path.Combine(Path.GetTempPath(), "cc-index-" + Guid.NewGuid().ToString("N")[..10]);
        Directory.CreateDirectory(scratch);
        string commitSha;
        string entry;
        try
        {
            var env = new Dictionary<string, string> { ["GIT_INDEX_FILE"] = Path.Combine(scratch, "index") };
            GitTree.Required(tree.GitRoot, ["read-tree", headSha], env);
            try
            {
                GitTree.Required(tree.GitRoot, ["apply", "--cached", "--recount", "-"], env, patch);
            }
            catch (GitCommandException error)
            {
                throw new GitConflictException($"could not apply change, file may differ: {error.Message}");
            }
            var treeSha = GitTree.Required(tree.GitRoot, ["write-tree"], env).Trim();
            commitSha = GitTree.Required(tree.GitRoot, ["commit-tree", treeSha, "-p", headSha, "-m", message], env).Trim();
            entry = GitTree.Required(tree.GitRoot, ["ls-tree", treeSha, "--", gitRelative], env).Trim();
        }
        finally
        {
            try { Directory.Delete(scratch, recursive: true); } catch (IOException) { }
        }
        GitTree.Required(tree.GitRoot, ["update-ref", "HEAD", commitSha]);
        if (entry.Length > 0)
        {
            var parts = entry.Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries);
            GitTree.Required(tree.GitRoot, ["update-index", "--cacheinfo", $"{parts[0]},{parts[2]},{gitRelative}"]);
        }
        return commitSha;
    }
}
