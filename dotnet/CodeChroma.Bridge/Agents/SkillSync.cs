using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Agents;

/// <summary>Installs the shipped codechroma-* skills (skills/ beside the bridge) into a project's or worktree's .claude/skills so agents there write canvas artifacts.</summary>
public static class SkillSync
{
    public const string SkillsEnv = "CODECHROMA_SKILLS_DIR";

    /// <summary>The single per-skill list: a new skill is one name here plus its directory under skills/.</summary>
    public static readonly IReadOnlyList<string> SkillNames =
    [
        "codechroma-draw-diagram",
        "codechroma-review-diagram",
        "codechroma-epic-brief",
        "codechroma-wiki-general-update",
        "codechroma-grill",
    ];

    /// <summary>Merged or retired away, but still installed in repos an earlier version analyzed; pruned on every sync.</summary>
    public static readonly IReadOnlyList<string> RetiredSkillNames =
    [
        "codechroma-c1", "codechroma-patterns", "codechroma-impact", "codechroma-custom-diagram", "codechroma-c1-review",
        "codechroma-impact-review", "codechroma-plan", "codechroma-research", "codechroma-wiki-general", "codechroma-diagram-type",
    ];

    public static readonly IReadOnlyList<string> ExcludePatterns =
        [.. SkillNames.Concat(RetiredSkillNames).Select(name => $".claude/skills/{name}/")];

    /// <summary>Every path a fresh agent, PR or branch worktree must never show as its own uncommitted work.</summary>
    public static readonly IReadOnlyList<string> WorktreeExcludes = [".codechroma/", .. ExcludePatterns];

    /// <summary>Folder name of the shipped skills, in the repo root and beside the bridge executable (the build copies one to the other).</summary>
    public const string SkillsFolder = "skills";

    /// <summary>Where the shipped skills live: $CODECHROMA_SKILLS_DIR, else the skills folder beside the bridge; no searching.</summary>
    public static string? SkillsRoot()
    {
        var configured = Environment.GetEnvironmentVariable(SkillsEnv)?.Trim();
        if (!string.IsNullOrEmpty(configured) && Directory.Exists(configured)) return Path.GetFullPath(configured);
        var beside = Path.Combine(AppContext.BaseDirectory, SkillsFolder);
        return Directory.Exists(Path.Combine(beside, SkillNames[0])) ? beside : null;
    }

    /// <summary>The directory handed to `claude --plugin-dir`: the parent of the skills dir.</summary>
    public static string? PluginDir() => SkillsRoot() is { } root ? Path.GetDirectoryName(root) : null;

    public static string? SkillSource(string name) => SkillsRoot() is { } root ? Path.Combine(root, name) : null;

    public static string SkillRelativePath(string name) => Path.Combine(".claude", "skills", name);

    /// <summary>Copies a skill into repoRoot/.claude/skills, replacing any stale copy; null when skipped.</summary>
    public static string? SyncSkill(string repoRoot, string name, string? source = null)
    {
        var resolved = source ?? SkillSource(name);
        var target = Path.Combine(repoRoot, SkillRelativePath(name));
        if (resolved is null || !Directory.Exists(resolved) || Path.GetFullPath(target) == Path.GetFullPath(resolved)) return null;
        if (Directory.Exists(target)) ForceDelete(target);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        CopyDirectory(resolved, target);
        return target;
    }

    /// <summary>Removes skills a previous version installed, so a merged-away name cannot linger forever.</summary>
    public static List<string> PruneRetired(string repoRoot)
    {
        var removed = new List<string>();
        foreach (var name in RetiredSkillNames)
        {
            var target = Path.Combine(repoRoot, SkillRelativePath(name));
            if (!Directory.Exists(target)) continue;
            try { ForceDelete(target); } catch (IOException) { }
            removed.Add(target);
        }
        return removed;
    }

    public static void SyncAll(string repoRoot)
    {
        foreach (var name in SkillNames) SyncSkill(repoRoot, name);
        PruneRetired(repoRoot);
    }

    /// <summary>Excludes the skill copies from git and installs them: for the opened project at bridge start and for every fresh worktree.</summary>
    public static void InstallIntoWorktree(string root)
    {
        GitExclude.Ensure(root, [.. WorktreeExcludes]);
        try { SyncAll(root); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"skills: could not install skills into {root}: {error.Message}");
        }
    }

    private static void CopyDirectory(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.GetFiles(from)) File.Copy(file, Path.Combine(to, Path.GetFileName(file)), overwrite: true);
        foreach (var directory in Directory.GetDirectories(from)) CopyDirectory(directory, Path.Combine(to, Path.GetFileName(directory)));
    }

    private static void ForceDelete(string directory)
    {
        foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories)) File.SetAttributes(file, FileAttributes.Normal);
        Directory.Delete(directory, recursive: true);
    }
}

/// <summary>Seeds a new worktree's diagram files from main so it opens already drawn (diagram_seed.py, pr_import_seed.py).</summary>
public static class DiagramSeed
{
    private static readonly string[] BuiltinKinds = ["c1", "patterns", "impact", "epics", "sequence"];
    private const string DefaultRequirementsSource = "file://plan/epics";
    private const string DefaultDeliverySource = "file://specs";

    /// <summary>Copies each diagram's artifact file from main into the target, if present and not already there.</summary>
    public static void SeedFromMain(string mainRoot, string targetRoot)
    {
        foreach (var kind in BuiltinKinds) CopyIfMissing(Artifact(mainRoot, kind), Artifact(targetRoot, kind));
    }

    /// <summary>Best-effort copy of main's authored diagrams, canvas doc, projections, custom types and requirements into a fresh PR checkout.</summary>
    public static void SeedPullRequestFromMain(string prRoot, string mainRoot)
    {
        if (SamePath(prRoot, mainRoot)) return;
        SeedFromMain(mainRoot, prRoot);
        SeedCanvasDoc(prRoot, mainRoot);
        CopyTree(Path.Combine(mainRoot, ".codechroma", "diagrams"), Path.Combine(prRoot, ".codechroma", "diagrams"), file => file.EndsWith("projection.json", StringComparison.Ordinal));
        CopyTree(Path.Combine(mainRoot, ".codechroma", "diagrams", "custom"), Path.Combine(prRoot, ".codechroma", "diagrams", "custom"), file => !file.EndsWith("projection.json", StringComparison.Ordinal));
        foreach (var uri in new[] { DefaultRequirementsSource, DefaultDeliverySource })
        {
            var relative = uri["file://".Length..];
            CopyTree(Path.Combine(mainRoot, relative), Path.Combine(prRoot, relative), _ => true, overwrite: true);
        }
    }

    /// <summary>Idempotent and narrow: reconcile at boot calls this alone, never the whole seed (its requirements copy overwrites).</summary>
    public static void SeedCanvasDoc(string prRoot, string mainRoot)
    {
        if (SamePath(prRoot, mainRoot)) return;
        CopyIfMissing(Path.Combine(mainRoot, ".codechroma", "canvas-core.json"), Path.Combine(prRoot, ".codechroma", "canvas-core.json"));
    }

    private static string Artifact(string root, string kind) => Path.Combine(root, ".codechroma", "diagrams", kind, kind + ".json");

    private static void CopyIfMissing(string source, string target)
    {
        try
        {
            if (!File.Exists(source) || File.Exists(target)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(source, target);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    private static void CopyTree(string sourceDir, string targetDir, Func<string, bool> accept, bool overwrite = false)
    {
        if (!Directory.Exists(sourceDir)) return;
        try
        {
            foreach (var file in Directory.EnumerateFiles(sourceDir, "*", SearchOption.AllDirectories))
            {
                if (!accept(file.Replace('\\', '/'))) continue;
                var target = Path.Combine(targetDir, Path.GetRelativePath(sourceDir, file));
                if (overwrite)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                    File.Copy(file, target, overwrite: true);
                }
                else CopyIfMissing(file, target);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    private static bool SamePath(string a, string b) =>
        string.Equals(Path.GetFullPath(a).TrimEnd('\\', '/'), Path.GetFullPath(b).TrimEnd('\\', '/'),
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
}
