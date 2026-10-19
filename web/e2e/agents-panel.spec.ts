import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Drives MockAgentClient (VITE_ENGINE_BRIDGE_URL is unset in the dev server the specs boot), so no
// git, no worktree and no `claude` process are involved — this pins the agents panel behaviour only.
type Page = import("@playwright/test").Page;

// "Run agent" always creates and starts a new agent attached to the active workspace immediately.
// MockAgentClient's id counter resets on every page load: "agent1", "agent2", and so on.
async function runAgent(page: Page): Promise<void> {
  await page.getByTestId("app-chrome").getByRole("button", { name: "Run agent" }).click();
}

async function switchBranchTo(page: Page, branch: string): Promise<void> {
  await page.getByTestId("branch-switcher-button").click();
  await page.getByTestId("branch-switcher-list").getByRole("button", { name: branch }).click();
}

test("clicking Run agent opens an agent tab immediately, with no dialog in between", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);

  await expect(page.getByTestId("agent-panel")).toHaveCount(0);
  await expect(page.getByTestId("agents-panel")).toBeVisible();
  await expect(page.getByTestId("agents-tab-agent1")).toBeVisible();
  await expect(page.getByTestId("agent-terminal-agent1")).toBeAttached();
});

test("launching twice opens two tabs", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);
  await expect(page.getByTestId("agents-tab-agent1")).toBeVisible();

  await runAgent(page);

  await expect(page.getByTestId("agents-tab-agent1")).toBeVisible();
  await expect(page.getByTestId("agents-tab-agent2")).toBeVisible();
});

// Hidden agents keep their xterm; marking the node proves it is the same one after switching back.
test("switching tabs keeps both terminals mounted, so it is not a reattach", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);
  await runAgent(page);

  const first = page.getByTestId("agent-terminal-agent1");
  await expect(first).toBeAttached();
  await first.evaluate((node) => node.setAttribute("data-e2e-mark", "original"));

  await page.getByTestId("agents-tab-agent1").click();
  await expect(page.getByTestId("agent-header-agent1")).toBeVisible();
  await page.getByTestId("agents-tab-agent2").click();
  await expect(page.getByTestId("agent-header-agent2")).toBeVisible();
  await expect(first).toBeAttached();
  await page.getByTestId("agents-tab-agent1").click();

  await expect(first).toHaveAttribute("data-e2e-mark", "original");
  await expect(page.getByTestId("agent-terminal-agent2")).toBeAttached();
});

test("collapsing shows the strip, and its a1 button reopens the panel on that agent", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);
  await runAgent(page);

  await page.getByRole("button", { name: "Collapse agents" }).click();

  await expect(page.getByTestId("agents-strip")).toBeVisible();
  await expect(page.getByTestId("agents-panel")).toBeHidden();

  await page.getByTestId("agents-strip-agent1").click();

  await expect(page.getByTestId("agents-panel")).toBeVisible();
  await expect(page.getByTestId("agent-header-agent1")).toBeVisible();
  await expect(page.getByTestId("agents-tab-agent1")).toHaveAttribute("aria-selected", "true");
});

test("full screen shows every agent as a column, and Esc or › returns to the panel", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);
  await runAgent(page);

  await page.getByRole("button", { name: "Full screen agents" }).click();

  await expect(page.getByTestId("agents-fullscreen")).toBeVisible();
  await expect(page.getByTestId("agents-column-agent1")).toBeVisible();
  await expect(page.getByTestId("agents-column-agent2")).toBeVisible();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("agents-fullscreen")).toHaveCount(0);
  await expect(page.getByTestId("agents-panel")).toBeVisible();

  await page.getByRole("button", { name: "Full screen agents" }).click();
  await expect(page.getByTestId("agents-fullscreen")).toBeVisible();
  await page.getByRole("button", { name: "Exit full screen agents" }).click();
  await expect(page.getByTestId("agents-fullscreen")).toHaveCount(0);
  await expect(page.getByTestId("agents-panel")).toBeVisible();
});

test("closing an agent removes its tab, with no confirmation to click", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);
  await runAgent(page);

  await page.getByTestId("agents-tab-agent1").click();
  await page.getByTestId("agent-close-agent1").click();

  await expect(page.getByTestId("agent-remove-dialog")).toHaveCount(0);
  await expect(page.getByTestId("agents-tab-agent1")).toHaveCount(0);
  await expect(page.getByTestId("agents-tab-agent2")).toBeVisible();
});

test("the sixth agent is refused: Run agent goes disabled with the limit as its label", async ({
  page,
}) => {
  await gotoApp(page);
  for (let i = 1; i <= 5; i += 1) {
    await runAgent(page);
    await expect(page.getByTestId(`agents-tab-agent${i}`)).toBeVisible();
  }

  const button = page.getByTestId("app-chrome").getByRole("button", { name: "Run agent" });
  await expect(button).toBeDisabled();
  await expect(button.locator(".rail-tooltip")).toHaveText(
    "5 agents is the limit — close one to start another",
  );
});

// launchAgent starts the process itself — the mock reports "idle" (at its prompt) right away.
test("the tab LED reflects the freshly launched agent's status, not just its existence", async ({
  page,
}) => {
  await gotoApp(page);
  await runAgent(page);

  await expect(page.getByTestId("agents-tab-agent1").locator(".agent-led")).toHaveClass(
    /agent-led-idle/,
  );
});

test("launching an agent leaves the main canvas workspace unchanged", async ({ page }) => {
  await gotoApp(page);
  const layer = page.getByTestId("agent-layer");
  await expect(layer).toHaveAttribute("data-active-workspace", "main");

  await runAgent(page);
  await expect(page.getByTestId("agents-tab-agent1")).toBeVisible();
  await expect(layer).toHaveAttribute("data-active-workspace", "main");

  await page.getByRole("button", { name: "Collapse agents" }).click();
  await page.getByTestId("agents-strip-agent1").click();
  await expect(page.getByTestId("agents-tab-agent1")).toBeVisible();
  await expect(layer).toHaveAttribute("data-active-workspace", "main");
});

// Agent terminals live in their own worktree, so changing main's branch neither hides nor tears them down.
test("switching branch keeps the agent tab and terminal mounted", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);
  const terminal = page.getByTestId("agent-terminal-agent1");
  await expect(terminal).toBeAttached();
  await terminal.evaluate((node) => node.setAttribute("data-e2e-mark", "original"));

  await switchBranchTo(page, "feature-x");

  await expect(page.getByTestId("agents-tab-agent1")).toBeVisible();
  await expect(page.getByTestId("agents-tab-agent1")).toHaveClass(/agents-tab-off-branch/);
  await expect(terminal).toHaveAttribute("data-e2e-mark", "original");
});

test("the branch switcher stays usable while an agent tab is open", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);

  await switchBranchTo(page, "feature-x");

  await expect(page.getByTestId("branch-switcher-button")).toHaveAttribute(
    "aria-label",
    "Branch: feature-x",
  );
  await expect(page.getByTestId("agents-tab-agent1")).toBeVisible();
  await expect(page.getByTestId("agent-layer")).toHaveAttribute("data-active-workspace", "main");
});

// Same contract the terminal panel has: the grid must reflow to the box, not stay at its first size.
test("resizing the panel via its edge handle reflows the xterm grid", async ({ page }) => {
  await gotoApp(page);
  await runAgent(page);

  const screen = page.getByTestId("agents-panel").locator(".xterm-screen").first();
  await expect(screen).toBeVisible();
  const before = await screen.boundingBox();
  if (!before) throw new Error("the agent terminal has no box");

  const handleBox = await page.getByTestId("agents-handle").boundingBox();
  if (!handleBox) throw new Error("the agents handle has no box");
  const x = handleBox.x + handleBox.width / 2;
  const y = handleBox.y + 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 150, y, { steps: 6 });
  await page.mouse.up();

  await expect(async () => {
    const after = await screen.boundingBox();
    expect(after?.width ?? 0).toBeGreaterThan(before.width + 60);
  }).toPass();
});
