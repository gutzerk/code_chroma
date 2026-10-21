using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Tests.Stores;

public class CliLocatorTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("cliloc").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private string MakeExe(string name)
    {
        var file = Path.Combine(_dir, OperatingSystem.IsWindows() ? name + ".exe" : name);
        File.WriteAllText(file, "x");
        return file;
    }

    [Fact]
    public void A_cli_missing_from_path_is_found_in_a_fallback_dir()
    {
        var exe = MakeExe("ghfake");

        var found = CliLocator.Find("ghfake", "", [_dir]);

        Assert.Equal(exe, found, ignoreCase: true);
    }

    [Fact]
    public void A_cli_in_no_searched_dir_is_not_found()
    {
        var found = CliLocator.Find("ghfake-absent", "", [_dir]);

        Assert.Null(found);
    }
}
