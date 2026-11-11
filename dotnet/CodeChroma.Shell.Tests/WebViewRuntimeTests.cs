namespace CodeChroma.Shell.Tests;

public class WebViewRuntimeTests
{
    [Theory]
    [InlineData(ShellOs.Linux, "", "libgtk-3.so.0,libwebkit2gtk-4.0.so.37")]
    [InlineData(ShellOs.Linux, "libgtk-3.so.0", "libwebkit2gtk-4.0.so.37")]
    [InlineData(ShellOs.Linux, "libgtk-3.so.0,libwebkit2gtk-4.0.so.37", "")]
    [InlineData(ShellOs.MacOs, "", "")]
    [InlineData(ShellOs.Windows, "", "")]
    public void Only_linux_reports_the_webview_libraries_it_cannot_load(ShellOs os, string loadable, string expected)
    {
        var available = loadable.Split(',', StringSplitOptions.RemoveEmptyEntries);

        var missing = WebViewRuntime.Missing(os, available.Contains);

        Assert.Equal(expected, string.Join(",", missing));
    }

    [Fact]
    public void The_advice_names_the_missing_library_and_the_package_to_install()
    {
        var (message, detail) = WebViewRuntime.Advice(["libwebkit2gtk-4.0.so.37"]);

        Assert.Contains("WebKitGTK", message);
        Assert.Contains("Missing: libwebkit2gtk-4.0.so.37.", detail);
        Assert.Contains("sudo apt install libwebkit2gtk-4.0-37", detail);
    }
}
