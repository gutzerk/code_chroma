import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

const csharp = readFileSync(new URL("../../dotnet/CodeChroma.Shell.App/DesktopScript.cs", import.meta.url), "utf8");
const raw = /Source = """\r?\n([\s\S]*?)\r?\n\s*""";/.exec(csharp);
if (!raw) throw new Error("DesktopScript.Source raw string not found");
const source = raw[1];

async function installDesktop(page: Page, text = "native clipboard") {
  await page.evaluate((initial) => {
    const host = window as unknown as {
      chrome: { webview: { postMessage: (json: string) => void } };
      __ccReply: (id: string, ok: boolean, json: string) => void;
      nativeClipboard: string;
    };
    host.nativeClipboard = initial;
    host.chrome = { webview: { postMessage(json) {
      const message = JSON.parse(json);
      if (message.type !== "clipboard") return;
      if (message.method === "write") host.nativeClipboard = message.arg;
      host.__ccReply(message.callId, true, JSON.stringify(message.method === "read" ? host.nativeClipboard : null));
    } } };
    Object.defineProperty(navigator, "clipboard", { value: {
      readText() { throw new Error("Browser clipboard must not be used"); },
      writeText() { throw new Error("Browser clipboard must not be used"); },
    }, configurable: true });
  }, text);
  await page.addScriptTag({ content: source });
}

test("desktop Cmd shortcuts copy, cut, paste and select all in text fields without browser clipboard", async ({ page }) => {
  await page.setContent('<input id="field" value="hello world"><textarea id="other"></textarea>');
  await installDesktop(page);
  const field = page.locator("#field");
  await field.focus();
  await field.evaluate((node: HTMLInputElement) => node.setSelectionRange(0, 5));
  await page.keyboard.press("Meta+c");
  await expect.poll(() => page.evaluate(() => (window as unknown as { nativeClipboard: string }).nativeClipboard)).toBe("hello");
  await page.keyboard.press("Meta+x");
  await expect(field).toHaveValue(" world");
  await page.keyboard.press("Meta+v");
  await expect(field).toHaveValue("hello world");
  await page.keyboard.press("Meta+a");
  expect(await field.evaluate((node: HTMLInputElement) => node.selectionEnd! - node.selectionStart!)).toBe(11);
});

test("a delayed desktop paste is discarded when focus moves", async ({ page }) => {
  await page.setContent('<input id="field" value="keep"><input id="other" value="unchanged">');
  await installDesktop(page);
  await page.evaluate(() => {
    const host = window as unknown as {
      chrome: { webview: { postMessage: (json: string) => void } };
      __ccReply: (id: string, ok: boolean, json: string) => void;
      replyToPaste: () => void;
    };
    host.chrome.webview.postMessage = (json) => {
      const message = JSON.parse(json);
      host.replyToPaste = () => host.__ccReply(message.callId, true, JSON.stringify("late"));
    };
  });
  await page.locator("#field").focus();
  await page.keyboard.press("Meta+v");
  await page.locator("#other").focus();
  await page.evaluate(() => (window as unknown as { replyToPaste: () => void }).replyToPaste());

  await expect(page.locator("#field")).toHaveValue("keep");
  await expect(page.locator("#other")).toHaveValue("unchanged");
});

test("desktop paste delivers text once through the real xterm paste handler", async ({ page }) => {
  await gotoApp(page, { files: false });
  await installDesktop(page, "hello\nworld");
  await page.getByRole("button", { name: "Run agent", exact: true }).click();
  const terminal = page.getByTestId("agent-terminal-agent1");
  await terminal.locator(".xterm-helper-textarea").focus();
  await terminal.evaluate((node) => {
    node.addEventListener("paste", (event) => {
      node.setAttribute("data-pasted", (event as ClipboardEvent).clipboardData!.getData("text/plain"));
      node.setAttribute("data-paste-count", String(Number(node.getAttribute("data-paste-count") ?? 0) + 1));
    }, true);
  });
  await page.keyboard.press("Meta+v");
  await expect(terminal).toHaveAttribute("data-pasted", "hello\nworld");
  await expect(terminal).toHaveAttribute("data-paste-count", "1");
});
