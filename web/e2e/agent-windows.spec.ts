import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Drives MockAgentClient (VITE_ENGINE_BRIDGE_URL is unset in the dev server the specs boot), so no
// git, no worktree and no `claude` process are involved — this pins the window behaviour only.
type Page = import("@playwright/test").Page;

// "Run agent" always creates and starts a new agent attached to the active workspace immediately —
// no title prompt, no picker. MockAgentClient's id counter resets on every page load, so the first
// agent a fresh test creates is always "agent1", the second "agent2", and so on.
async function runAgent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Run agent" }).click();
}

async function showAgentsTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Agents", exact: true }).click();
}

test("clicking Run agent opens a running window immediately, with no dialog in between", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);

  await expect(page.getByTestId("agent-panel")).toHaveCount(0);
  const window = page.getByTestId("agent-window-agent1");
  await expect(window).toBeVisible();
  await expect(page.getByTestId("agent-terminal-agent1")).toBeAttached();
});

test("clicking Run agent twice from the same active workspace opens two independent windows", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);
  await expect(page.getByTestId("agent-window-agent1")).toBeVisible();

  await runAgent(page);

  await expect(page.getByTestId("agent-window-agent1")).toBeVisible();
  await expect(page.getByTestId("agent-window-agent2")).toBeVisible();
});

test("the window drags, minimizes and restores from the rail", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);

  const window = page.getByTestId("agent-window-agent1");
  await expect(window).toBeVisible();

  const before = await window.boundingBox();
  if (!before) throw new Error("the agent window has no box");
  const title = page.getByTestId("agent-title-agent1");
  await title.hover();
  await page.mouse.down();
  await page.mouse.move(before.x + 220, before.y + 140, { steps: 8 });
  await page.mouse.up();

  const after = await window.boundingBox();
  if (!after) throw new Error("the agent window vanished mid-drag");
  expect(Math.abs(after.x - before.x)).toBeGreaterThan(40);

  await page.getByRole("button", { name: "Minimize agent1" }).click();
  await expect(window).toBeHidden();

  await showAgentsTab(page);
  await page.getByTestId("agent-rail-agent1").click();
  await expect(window).toBeVisible();
});

// The rail's strip lists every agent for its whole lifetime: restoring flips the entry's pressed
// state rather than removing it.
test("the rail keeps an entry per agent and toggles its window from there", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);
  await showAgentsTab(page);

  const entry = page.getByTestId("agent-rail-agent1");
  const window = page.getByTestId("agent-window-agent1");
  await expect(entry).toHaveAttribute("aria-pressed", "true");

  await entry.click();

  await expect(window).toBeHidden();
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("aria-pressed", "false");

  await entry.click();

  await expect(window).toBeVisible();
  await expect(entry).toHaveAttribute("aria-pressed", "true");
});

// A hidden tooltip parked below the card (`top: calc(100% + 6px)`) used to inflate the panel's
// scrollHeight even while invisible, forcing a scrollbar on the body with a single agent card.
test("the rail body has no scrollbar when a single agent fits comfortably", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);

  const overflow = await page.evaluate(() => {
    const body = document.querySelector(".agent-task-rail-body");
    if (!body) throw new Error("agent-task-rail-body not found");
    return body.scrollHeight - body.clientHeight;
  });

  expect(overflow).toBeLessThanOrEqual(0);
});

// Minimized used to leave only a colored dot; the rail entry must still say which task it is and
// what it's doing.
test("a minimized window's rail entry shows the task title and status as text", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);
  await page.getByRole("button", { name: "Minimize agent1" }).click();
  await showAgentsTab(page);

  const entry = page.getByTestId("agent-rail-agent1");
  await expect(entry.locator(".agent-rail-title")).toHaveText("agent1");
  await expect(entry.locator(".agent-rail-status")).toHaveText("Idle");
});

// The window layer used to filter minimized agents out before rendering, which disposed the xterm
// and made every restore a full reattach. Marking the node proves it is the same one on the way back.
test("minimizing keeps the agent's terminal mounted, so restoring is not a reattach", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);

  const terminal = page.getByTestId("agent-terminal-agent1");
  await expect(terminal).toBeAttached();
  await terminal.evaluate((node) => node.setAttribute("data-e2e-mark", "original"));

  await page.getByRole("button", { name: "Minimize agent1" }).click();
  await expect(page.getByTestId("agent-window-agent1")).toBeHidden();
  await expect(terminal).toBeAttached();

  await showAgentsTab(page);
  await page.getByTestId("agent-rail-agent1").click();

  await expect(page.getByTestId("agent-window-agent1")).toBeVisible();
  await expect(terminal).toHaveAttribute("data-e2e-mark", "original");
});

// Same contract the terminal panel has: the grid must reflow to the box, not stay at its first size.
test("resizing an agent window reflows its xterm grid", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);
  await showAgentsTab(page);

  const screen = page.getByTestId("agent-window-agent1").locator(".xterm-screen");
  await expect(screen).toBeVisible();
  const before = await screen.boundingBox();
  if (!before) throw new Error("the agent terminal has no box");

  const handle = page.getByTestId("agent-resize-agent1");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("the agent resize handle has no box");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 300, handleBox.y + 120, { steps: 6 });
  await page.mouse.up();

  await expect(async () => {
    const after = await screen.boundingBox();
    expect(after?.width ?? 0).toBeGreaterThan(before.width + 150);
  }).toPass();
});

test("closing an agent takes its window away, with no confirmation to click", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);

  await page.getByRole("button", { name: "Close agent1" }).click();

  await expect(page.getByTestId("agent-remove-dialog")).toHaveCount(0);
  await expect(page.getByTestId("agent-window-agent1")).toHaveCount(0);
});

test("the sixth agent is refused: Run agent goes disabled with the limit as its label", async ({
  page,
}) => {
  await gotoApp(page);
  for (let i = 1; i <= 5; i += 1) {
    await runAgent(page);
    await expect(page.getByTestId(`agent-window-agent${i}`)).toBeVisible();
  }

  const button = page.getByRole("button", { name: "Run agent" });
  await expect(button).toBeDisabled();
  await expect(button.locator(".rail-tooltip")).toHaveText(
    "5 agents is the limit — close one to start another",
  );
});

test("an agent window stays put under canvas zoom, since it lives in screen coordinates", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);

  const window = page.getByTestId("agent-window-agent1");
  const before = await window.boundingBox();
  if (!before) throw new Error("the agent window has no box");

  // Aim at a canvas point the window does not cover — it sits above the canvas on purpose.
  await page.mouse.move(1180, 660);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(200);

  const after = await window.boundingBox();
  if (!after) throw new Error("the agent window vanished after zooming");
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
});

// launchAgent starts the process itself — the mock reports "idle" (at its prompt) right away, with
// no separate Start step exposed anywhere in the UI.
test("the rail LED reflects the freshly launched agent's status, not just its existence", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);
  await showAgentsTab(page);

  const railLed = page.getByTestId("agent-rail-agent1").locator(".agent-led");
  await expect(railLed).toHaveClass(/agent-led-idle/);
});

// Launching an agent opens its own terminal window without changing the canvas workspace.
test("launching an agent leaves the main canvas workspace unchanged", async ({ page }) => {
  await gotoApp(page);
  const layer = page.getByTestId("agent-layer");
  await expect(layer).toHaveAttribute("data-active-workspace", "main");

  await runAgent(page);
  await expect(page.getByTestId("agent-window-agent1")).toBeVisible();
  await expect(layer).toHaveAttribute("data-active-workspace", "main");

  await page.getByRole("button", { name: "Minimize agent1" }).click();
  await showAgentsTab(page);
  await page.getByTestId("agent-rail-agent1").click();
  await expect(page.getByTestId("agent-window-agent1")).toBeVisible();
  await expect(layer).toHaveAttribute("data-active-workspace", "main");
});

async function switchBranchTo(page: Page, branch: string): Promise<void> {
  await page.getByTestId("branch-switcher-button").click();
  await page.getByTestId("branch-switcher-list").getByRole("button", { name: branch }).click();
}

// Agent terminals live in their own worktree, so changing main's branch does not hide them.
test("switching branch keeps the agent window visible and labels its rail entry", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);
  await showAgentsTab(page);
  const window = page.getByTestId("agent-window-agent1");
  const entry = page.getByTestId("agent-rail-agent1");

  await switchBranchTo(page, "feature-x");

  await expect(window).toBeVisible();
  await expect(entry).toHaveClass(/agent-rail-item-off-branch/);
  await expect(entry.locator(".agent-rail-status")).toHaveText("on main");

  await entry.click();
  await expect(window).toBeHidden();
  await entry.click();
  await expect(window).toBeVisible();
});

// A main-branch change cannot tear down an agent terminal running in its own worktree.
test("switching branches keeps the agent terminal mounted", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);
  await expect(page.getByTestId("agent-terminal-agent1")).toBeAttached();

  await switchBranchTo(page, "feature-x");

  await expect(page.getByTestId("agent-window-agent1")).toBeVisible();
  await expect(page.getByTestId("agent-terminal-agent1")).toBeAttached();
});

// The branch switcher continues to operate while an agent window is open.
test("the branch switcher stays usable while an agent window is open", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);

  await switchBranchTo(page, "feature-x");

  await expect(page.getByTestId("branch-switcher-button")).toHaveAttribute(
    "aria-label",
    "Branch: feature-x",
  );
  await expect(page.getByTestId("agent-window-agent1")).toBeVisible();
  await expect(page.getByTestId("agent-layer")).toHaveAttribute("data-active-workspace", "main");
  await expect(page.getByTestId("agent-layer")).toHaveAttribute("data-active-workspace", "main");
});
