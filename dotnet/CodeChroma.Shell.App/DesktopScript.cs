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
            closeThisProject: function () { return post({ type: "close-project" }); },
            writeClipboard: function (text) { return rpc({ type: "clipboard", method: "write", arg: text }); },
            saveFile: function (name, mime, base64) { return rpc({ type: "save-file", id: name, method: mime, arg: base64 }); }
          };
          function snap(t, input) {
            if (input) return { v: t.value, s: t.selectionStart, e: t.selectionEnd };
            var g = window.getSelection();
            return { v: t.textContent, n: g.anchorNode, a: g.anchorOffset, f: g.focusNode, o: g.focusOffset };
          }
          function same(x, y) { for (var k in x) if (x[k] !== y[k]) return false; return true; }
          document.addEventListener("keydown", function (e) {
            if (!e.isTrusted || !(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
            var key = e.key.toLowerCase();
            if (key !== "c" && key !== "x" && key !== "v" && key !== "a") return;
            var target = document.activeElement;
            if (!target) return;
            var xterm = target.classList.contains("xterm-helper-textarea");
            var input = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
            var editable = (input || target.isContentEditable) && !target.readOnly && !target.disabled;
            if (key === "a") {
              if (xterm) return;
              if (input && target.select) { e.preventDefault(); target.select(); }
              else if (target.isContentEditable || target === document.body) { e.preventDefault(); document.execCommand("selectAll"); }
              return;
            }
            if (key === "v") {
              if (!editable) return;
              e.preventDefault();
              var before = snap(target, input);
              readClipboard().then(function (text) {
                if (!target.isConnected || document.activeElement !== target || !same(before, snap(target, input))) return;
                if (xterm) {
                  var data = new DataTransfer();
                  data.setData("text/plain", text);
                  target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
                } else document.execCommand("insertText", false, text);
              }).catch(function () {});
              return;
            }
            if (xterm) return;
            var text = input ? target.value.slice(target.selectionStart, target.selectionEnd) : String(window.getSelection());
            if (!text) return;
            e.preventDefault();
            var sent = snap(target, input);
            window.codechromaDesktop.writeClipboard(text).then(function () {
              if (key !== "x" || !editable || document.activeElement !== target || !same(sent, snap(target, input))) return;
              document.execCommand("delete");
            }).catch(function () {});
          }, true);
          var pending = {}, listeners = [], nextCall = 0;
          window.__ccReply = function (id, ok, json) {
            var call = pending[id]; delete pending[id];
            if (!call) return;
            if (ok) call.resolve(JSON.parse(json)); else call.reject(new Error(json));
          };
          window.__ccUpdatesPush = function (json) {
            var state = JSON.parse(json);
            listeners.slice().forEach(function (fn) { fn(state); });
          };
          function readClipboard() { return rpc({ type: "clipboard", method: "read" }); }
          function rpc(message) {
            return new Promise(function (resolve, reject) {
              message.callId = "c" + (++nextCall);
              pending[message.callId] = { resolve: resolve, reject: reject };
              post(message);
            });
          }
          function call(method, arg) {
            return rpc({ type: "updates", method: method, arg: arg === undefined ? undefined : String(arg) });
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
