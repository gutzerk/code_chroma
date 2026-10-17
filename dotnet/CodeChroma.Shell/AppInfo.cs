namespace CodeChroma.Shell;

public sealed record AboutInfo(string Title, string Message, string Detail);

public static class AppInfo
{
    public const string RepoUrl = "https://github.com/gutzerk/code_chroma";

    private static string Bare(string version)
    {
        var trimmed = version.Trim();
        return trimmed.Length > 0 && (trimmed[0] is 'v' or 'V') ? trimmed[1..] : trimmed;
    }

    public static string WindowTitle(string version, string? tab = null)
    {
        var v = Bare(version);
        var product = v.Length > 0 ? $"CodeChroma {v}" : "CodeChroma";
        return string.IsNullOrEmpty(tab) ? product : $"{tab} - {product}";
    }

    public static AboutInfo About(string version) =>
        new("About CodeChroma", "CodeChroma", $"Version {Bare(version)}\n{RepoUrl}");
}
