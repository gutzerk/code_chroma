namespace CodeChroma.Bridge.Workspaces;

/// <summary>Every tunable the Python bridge hard-codes or reads from config.py, kept identical.</summary>
public static class BridgeLimits
{
    public const int IdleUnloadSeconds = 600;
    public const string PatternsGeneratorModel = "claude-haiku-4-5";
    public const int PatternsGeneratorMaxTokens = 2000;
    public const int IdleSweepSeconds = 60;
    public const int RepoDebounceMs = 1000;
    public const int WatcherDebounceMs = 500;
    public const int GitShortTimeoutSeconds = 10;
    public const int GitLongTimeoutSeconds = 120;
    public const int SocketSendTimeoutSeconds = 5;

    public const int StructureDefaultDepth = 2;
    public const int StructureDefaultMaxChildren = 40;
    public const int StructureDefaultMaxNodes = 300;
    public const int StructureMaxDepth = 5;
    public const int StructureMaxChildren = 200;
    public const int StructureMaxNodes = 1000;
    public const int StructureSummaryChars = 160;

    /// <summary>Directory names neither the repo watcher nor the status sync care about (engine.IGNORED_DIRS).</summary>
    public static readonly IReadOnlySet<string> IgnoredDirs = new HashSet<string>
    {
        ".DS_Store", ".codechroma", ".editorconfig", ".git", ".idea", ".mypy_cache", ".pytest_cache",
        ".ruff_cache", ".venv", ".vscode", "__pycache__", "build", "dist", "node_modules", "venv",
    };
}
