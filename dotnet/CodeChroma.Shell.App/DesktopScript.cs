namespace CodeChroma.Shell.App;

/// <summary>The page-side half of window.codechromaDesktop: posts JSON messages to the shell over the WebView's message channel.</summary>
public static class DesktopScript
{
    public const string Source = """
        (function () {
          if (window.codechromaDesktop) return;
          function post(message) {
            var text = JSON.stringify(message);
            if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(text);
            else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.webview) window.webkit.messageHandlers.webview.postMessage(text);
            else if (window.external && window.external.notify) window.external.notify(text);
            return Promise.resolve();
          }
          window.codechromaDesktop = {
            openWorkspaceWindow: function (id) { return post({ type: "open-workspace", id: id }); },
            closeWorkspaceWindow: function (id) { return post({ type: "close-workspace", id: id }); },
            focusThisTab: function () { return post({ type: "focus-tab" }); },
            closeThisProject: function () { return post({ type: "close-project" }); }
          };
        })();
        """;
}
