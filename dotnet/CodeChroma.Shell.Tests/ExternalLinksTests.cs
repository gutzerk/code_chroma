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
