namespace CodeChroma.Bridge;

/// <summary>The shell's launch contract: <c>--repo-path X --port N</c>; everything else flows to ASP.NET Core.</summary>
public sealed record BridgeCli(string? RepoPath, int? Port, string[] Remaining)
{
    public static BridgeCli Parse(string[] args)
    {
        string? repo = null;
        int? port = null;
        var rest = new List<string>();
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--repo-path" && i + 1 < args.Length) repo = args[++i];
            else if (args[i] == "--port" && i + 1 < args.Length && int.TryParse(args[i + 1], out var p)) { port = p; i++; }
            else rest.Add(args[i]);
        }
        return new BridgeCli(repo, port, [.. rest]);
    }
}
