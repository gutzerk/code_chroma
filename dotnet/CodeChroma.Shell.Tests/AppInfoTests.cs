namespace CodeChroma.Shell.Tests;

public class AppInfoTests
{
    [Theory]
    [InlineData("0.12.1", null, "CodeChroma 0.12.1")]
    [InlineData("v0.12.1", null, "CodeChroma 0.12.1")]
    [InlineData("0.12.1", "repo [Main]", "repo [Main] - CodeChroma 0.12.1")]
    [InlineData("", null, "CodeChroma")]
    [InlineData("  ", "repo [Main]", "repo [Main] - CodeChroma")]
    public void The_window_title_carries_the_version_and_the_active_tab(string version, string? tab, string expected)
    {
        var title = AppInfo.WindowTitle(version, tab);

        Assert.Equal(expected, title);
    }

    [Fact]
    public void The_about_entry_names_the_product_the_version_and_the_project_page()
    {
        var about = AppInfo.About("v0.12.1");

        Assert.Equal("About CodeChroma", about.Title);
        Assert.Contains("Version 0.12.1", about.Detail);
        Assert.Contains("https://github.com/gutzerk/code_chroma", about.Detail);
    }
}
