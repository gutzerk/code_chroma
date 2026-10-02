#!/usr/bin/env node
// Manual, human-approval-gated canvas verification (docs/planning/014). NOT part of `npm test`,
// `npm run e2e`, or CI. Drives Playwright/Chromium in a visible window so a person can watch the
// click-through, against the mock bridge on http://localhost:5173 (start `npm run dev` yourself).
// Terminal/ws errors here are expected-without-backend and annotated, not failures.
import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(__dirname, "..", "artifacts");

// Rail controls: label when off/on + whether clicking "on" yields a label that flips back on a
// second click. Diagram-view and agent toggles are clicked but not label-asserted (their labels
// don't promise a stable back-flip in the mock without a real agent/backend).
const TOGGLES = [
  { off: "Show diff vs last commit", on: "Hide diff, keep code open" },
  { off: "Show the AI plan on the canvas", on: "Hide the AI plan overlay" },
  { off: "Ask a question about this codebase", on: "Close research panel" },
  { off: "Open terminal panel", on: "Close terminal panel" },
  { off: "Replay an execution trace", on: "Hide execution trace playback" },
];

const CLICK_ONLY = [
  { name: "Run agent", role: "button" },
  { name: "Add agent here", role: "button" },
];

// Console/page/network errors that are expected with the mock and no backend. Everything else is a
// REAL_BUG candidate that drives a non-zero exit.
const EXPECTED = [
  /Cannot read propert.* of undefined .*dimensions/i,
  /websocket.*connect.*refused/i,
  /ECONNREFUSED/i,
];

function isExpected(message) {
  return EXPECTED.some((re) => re.test(message));
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    }),
  );
}

async function main() {
  console.log(
    [
      "Manual canvas verification (014) — mock bridge, port 5173.",
      "Make sure `npm run dev` is running first (it must serve the mock, not a real bridge).",
      "Known-expected errors while the backend is down: xterm 'dimensions', ws://localhost:8000 refused.",
      "",
    ].join("\n"),
  );
  const answer = await ask("Run manual canvas verification now? [y/N] ");
  if (answer !== "y") {
    console.log("Skipped — no browser was opened.");
    process.exit(0);
  }

  await mkdir(ARTIFACTS, { recursive: true });
  const results = [];
  const browser = await chromium.launch({ headless: false });
  try {
    for (const strategy of ["tree", "boxes"]) {
      results.push(await runStrategy(browser, strategy));
    }
  } finally {
    await browser.close();
  }

  let failing = 0;
  console.log("\n=== Summary ===");
  for (const r of results) {
    for (const check of r.checks) {
      console.log(`[${check.pass ? "PASS" : "FAIL"}] ${r.strategy}: ${check.name}${check.note ? ` — ${check.note}` : ""}`);
      if (!check.pass) failing += 1;
    }
  }
  for (const r of results) {
    console.log(`\n${r.strategy}: ${r.totalErrors} error(s) — ${r.expectedErrors} expected, ${r.unexpectedErrors} unexpected`);
    for (const err of r.errors) console.log(`  ${err.kind}: ${err.text.slice(0, 160)}`);
  }
  process.exit(failing > 0 || results.some((r) => r.unexpectedErrors > 0) ? 1 : 0);
}

async function runStrategy(browser, strategy) {
  const page = await browser.newPage();
  const checks = [];
  const errors = [];
  let expectedErrors = 0;
  let unexpectedErrors = 0;
  let u = 0;
  const snap = async (name) => {
    u += 1;
    await page.screenshot({ path: path.join(ARTIFACTS, `verify-${strategy}-${u}-${name}.png`) });
  };

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      errors.push({ kind: "console", text });
      if (isExpected(text)) expectedErrors += 1;
      else unexpectedErrors += 1;
    }
  });
  page.on("pageerror", (err) => {
    const text = `${err.message}${err.stack ? `\n${err.stack}` : ""}`;
    errors.push({ kind: "pageerror", text });
    if (isExpected(err.message)) expectedErrors += 1;
    else unexpectedErrors += 1;
  });
  page.on("requestfailed", (req) => {
    const text = `${req.url()} — ${req.failure()?.errorText ?? "failed"}`;
    errors.push({ kind: "request", text });
    if (isExpected(text)) expectedErrors += 1;
    else unexpectedErrors += 1;
  });

  await page.goto(`/?strategy=${strategy}&autoexpand=off`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="app-root"]');

  // Canvas mounted (no error boundary swapped #root for a blank screen).
  const rootChildren = await page.locator("#root").locator(":scope > *").count();
  checks.push({ strategy, name: "#root mounted with content", pass: rootChildren > 0, note: `${rootChildren} child` });

  // Every toggle flips aria-pressed (and its label by extension), and flips back on the next click.
  for (const t of TOGGLES) {
    const btn = page.getByRole("button", { name: t.off });
    const visible = await btn.isVisible().catch(() => false);
    if (!visible) {
      checks.push({ strategy, name: `toggle: ${t.off}`, pass: false, note: "button not found" });
      continue;
    }
    await btn.click();
    const onPressed = await btn.getAttribute("aria-pressed");
    await snap(`on-${slug(t.off)}`);
    await btn.click();
    const offPressed = await btn.getAttribute("aria-pressed");
    checks.push({
      strategy,
      name: `toggle: ${t.off}`,
      pass: onPressed === "true" && offPressed === "false",
      note: `pressed on=${onPressed} off=${offPressed}`,
    });
    // Diff is the only toggle that leaves revealed code boxes behind; clear them after it.
    if (t.off.startsWith("Show diff")) {
      await diffBtnHiddenRestore(page);
    }
  }

  // Diff-specific assertions (on-position regression, reproduced live).
  const diffBtn = page.getByRole("button", { name: "Show diff vs last commit" });
  await diffBtn.click();
  const diffCount = await page.getByTestId("diff-view").count();
  const inlineCount = await page.locator(".block-code-view--inline").count();
  let onPosition = true;
  const canvasBox = await page.getByTestId("canvas-area").boundingBox();
  const diffBoxes = [];
  for (let i = 0; i < diffCount; i += 1) {
    const b = await page.getByTestId("diff-view").nth(i).boundingBox();
    if (b && canvasBox) {
      diffBoxes.push(b);
      if (!(b.y + b.height > canvasBox.y && b.y < canvasBox.y + canvasBox.height && b.x < canvasBox.x + canvasBox.width)) {
        onPosition = false;
      }
    }
  }
  checks.push({ strategy, name: "diff panels appear on-position", pass: diffCount > 0 && onPosition, note: `${diffCount} diffs, ${inlineCount} inline, ${diffBoxes.length} in canvas` });
  await snap("diff-on");

  // Accept one diff: its panel disappears, diff mode stays active.
  const beforeAccept = await page.getByTestId("diff-view").count();
  const firstAccept = page.getByTestId("diff-accept-button").first();
  await firstAccept.click();
  const afterAccept = await page.getByTestId("diff-view").count();
  checks.push({
    strategy,
    name: "diff accept removes one panel, mode stays on",
    pass: afterAccept === beforeAccept - 1,
    note: `before=${beforeAccept} after=${afterAccept}`,
  });
  await page.getByRole("button", { name: "Hide diff, keep code open" }).click();
  const diffOffCount = await page.getByTestId("diff-view").count();
  checks.push({ strategy, name: "diff toggle off restores view", pass: diffOffCount === 0, note: `${diffOffCount} diff-view` });

  // Run/Add agent are click-tried (visible result needs a real agent; disable-state click is safe).
  for (const c of CLICK_ONLY) {
    const btn = page.getByRole(c.role, { name: c.name }).first();
    const visible = await btn.isVisible().catch(() => false);
    const disabled = visible ? ((await btn.getAttribute("disabled")) !== null) : true;
    if (visible && !disabled) await btn.click().catch(() => {});
    checks.push({ strategy, name: `agent control: ${c.name}`, pass: visible, note: visible ? (disabled ? "disabled" : "clicked") : "not found" });
  }

  // Every open panel stays inside the canvas window.
  const panelSelectors = [".diff-view", ".plan-panel", ".research-panel", ".terminal-panel", ".CodePopup"];
  for (const sel of panelSelectors) {
    const count = await page.locator(sel).count();
    if (count === 0) continue;
    let inside = true;
    for (let i = 0; i < count; i += 1) {
      const b = await page.locator(sel).nth(i).boundingBox();
      if (b && canvasBox && (b.x < canvasBox.x || b.y < canvasBox.y || b.x + b.width > canvasBox.x + canvasBox.width)) {
        inside = false;
      }
    }
    checks.push({ strategy, name: `panel ${sel} inside canvas`, pass: inside, note: `${count} found` });
  }

  await snap("final");
  await page.close();
  return { strategy, checks, errors, totalErrors: errors.length, expectedErrors, unexpectedErrors };
}

// Diff isn't toggle-probed in the label loop (it needs the dedicated stage below), so after the
// other toggles just make sure no diff state leaked in from a prior control.
async function diffBtnHiddenRestore(page) {
  if (await page.getByTestId("diff-view").count()) {
    await page.getByRole("button", { name: "Hide diff, keep code open" }).click().catch(() => {});
  }
}

function slug(label) {
  return label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

main().catch((err) => {
  console.error(`Cannot run canvas verification: ${err.message}`);
  process.exit(1);
});
