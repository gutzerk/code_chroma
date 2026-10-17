// Boots the shell with --repo against the frozen bridge and checks the canvas, the window title and the desktop API over CDP (Windows/WebView2).
// usage: node smoke.mjs <path to CodeChroma.Shell.App.exe> <path to codechroma-bridge.exe> <repo dir> [expected version]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [exe, bridge, repo, version = "0.12.1"] = process.argv.slice(2);
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { return []; } };

async function evalIn(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const res = await new Promise((resolve) => {
    ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d); });
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  return res.result?.result?.value;
}

const canvases = async () => (await targets()).filter((t) => t.type === "page" && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url));
const title = (pid) => execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).MainWindowTitle`]).toString().trim();
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

const child = spawn(exe, ["--repo", repo], {
  stdio: "ignore",
  env: { ...process.env, CODECHROMA_BRIDGE: bridge, CODECHROMA_VERSION: version, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`, WEBVIEW2_USER_DATA_FOLDER: mkdtempSync(join(tmpdir(), "cc-smoke-")) },
});
try {
  const t0 = Date.now();
  let canvas = null;
  while (Date.now() - t0 < 120000 && !canvas) {
    for (const t of await canvases()) {
      const n = await evalIn(t, "document.readyState==='complete' ? document.querySelectorAll('#root *').length : 0").catch(() => 0);
      if (n > 40) canvas = t;
    }
    if (!canvas) await sleep(200);
  }
  check("canvas renders inside the shell", canvas, canvas && `${Date.now() - t0} ms, ${canvas.url}`);
  if (canvas) {
    check("canvas opens the main workspace", canvas.url.includes("workspace=main"));
    check("desktop API is present", (await evalIn(canvas, "typeof window.codechromaDesktop?.openWorkspaceWindow")) === "function");
    const expected = `${repo.split(/[\\/]/).filter(Boolean).pop()} [Main] - CodeChroma ${version}`;
    check("window title carries project and version", title(child.pid) === expected, `got "${title(child.pid)}"`);
    await evalIn(canvas, "window.codechromaDesktop.openWorkspaceWindow('pr-9')");
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !(await canvases()).some((t) => t.url.includes("workspace=pr-9"))) await sleep(200);
    const opened = (await canvases()).find((t) => t.url.includes("workspace=pr-9"));
    check("a PR tab opens on the same bridge", opened && new URL(opened.url).origin === new URL(canvas.url).origin, opened?.url);
    check("window title follows the PR tab", /\[PR #9\] - CodeChroma/.test(title(child.pid)), `got "${title(child.pid)}"`);
  }
} finally {
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
  try { execFileSync("taskkill", ["/IM", "codechroma-bridge.exe", "/F"], { stdio: "ignore" }); } catch { /* none left */ }
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
