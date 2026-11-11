namespace CodeChroma.Shell;

/// <summary>Native libraries the canvas WebView needs; on Linux a missing one makes WebView.Avalonia hang the UI thread forever.</summary>
public static class WebViewRuntime
{
    public static IReadOnlyList<string> LinuxLibraries { get; } = ["libgtk-3.so.0", "libwebkit2gtk-4.0.so.37"];

    /// <summary>The required libraries <paramref name="canLoad"/> cannot load; always empty off Linux.</summary>
    public static IReadOnlyList<string> Missing(ShellOs os, Func<string, bool> canLoad) =>
        os == ShellOs.Linux ? LinuxLibraries.Where(library => !canLoad(library)).ToList() : [];

    /// <summary>What the window shows instead of the canvas when <paramref name="missing"/> is not empty.</summary>
    public static (string Message, string Detail) Advice(IReadOnlyList<string> missing) => (
        "CodeChroma needs WebKitGTK 4.0 to show its canvas",
        $"Missing: {string.Join(", ", missing)}.\n\n"
        + "Debian / Ubuntu 22.04: sudo apt install libwebkit2gtk-4.0-37\n"
        + "Fedora: sudo dnf install webkit2gtk4.0\n\n"
        + "Then start CodeChroma again. Distributions that ship only WebKitGTK 4.1 (for example Ubuntu 24.04) are not supported yet.");
}
