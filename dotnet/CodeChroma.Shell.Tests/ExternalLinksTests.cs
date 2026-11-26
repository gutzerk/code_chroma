namespace CodeChroma.Shell.Tests;

public class ExternalLinksTests
{
    [Theory]
    [InlineData("https://acme.slack.com/archives/C1/p1", true)]
    [InlineData("slack://channel?team=T1&id=C1&message=1.2", true)]
    [InlineData("file:///etc/passwd", false)]
    [InlineData("javascript:alert(1)", false)]
    public void Only_web_and_slack_links_open_outside_the_app(string url, bool expected)
    {
        var target = new Uri(url);

        var allowed = ExternalLinks.CanOpen(target);

        Assert.Equal(expected, allowed);
    }
}

public class ExternalLinksOriginTests
{
    [Theory]
    [InlineData("http://127.0.0.1:22760/", false)]
    [InlineData("http://127.0.0.1:22760/?workspace=pr-4", false)]
    [InlineData("about:blank", false)]
    [InlineData("http://127.0.0.1:22761/", true)]
    [InlineData("https://github.com/gutzerk/code_chroma", true)]
    [InlineData("file:///etc/passwd", false)]
    public void The_tabs_own_bridge_never_opens_in_the_system_browser(string url, bool expected)
    {
        var target = new Uri(url);

        var external = ExternalLinks.OpensExternally(target, "http://127.0.0.1:22760");

        Assert.Equal(expected, external);
    }

    [Fact]
    public void A_tab_without_a_bridge_matches_no_origin()
    {
        var target = new Uri("http://127.0.0.1:22760/");

        var onOrigin = ExternalLinks.IsOnOrigin(target, null);

        Assert.False(onOrigin);
    }
}
