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
          var pending = {}, listeners = [], nextCall = 0;
          window.__ccUpdatesReply = function (id, ok, json) {
            var call = pending[id]; delete pending[id];
            if (!call) return;
            if (ok) call.resolve(JSON.parse(json)); else call.reject(new Error(json));
          };
          window.__ccUpdatesPush = function (json) {
            var state = JSON.parse(json);
            listeners.slice().forEach(function (fn) { fn(state); });
          };
          function call(method, arg) {
            return new Promise(function (resolve, reject) {
              var id = "u" + (++nextCall);
              pending[id] = { resolve: resolve, reject: reject };
              post({ type: "updates", callId: id, method: method, arg: arg === undefined ? undefined : String(arg) });
            });
          }
          window.codechromaUpdates = {
            state: function () { return call("state"); },
            check: function () { return call("check"); },
            download: function () { return call("download"); },
            restart: function () { return call("restart"); },
            skip: function (version) { return call("skip", version); },
            setAutoDownload: function (enabled) { return call("auto-download", enabled); },
            subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }
          };
        })();
        """;
}
