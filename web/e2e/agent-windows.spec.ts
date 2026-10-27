import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test("agent shortcuts cycle from inside a terminal and reopen the agents tab", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Run agent" }).click();
  await page.getByRole("button", { name: "Run agent" }).click();
  const first = page.getByTestId("agent-dock-panel-agent1");
  const second = page.getByTestId("agent-dock-panel-agent2");
  await second.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Alt+ArrowRight");
  await expect(first).toBeVisible();
  await expect(first.locator(".xterm-helper-textarea")).toBeFocused();
  await page.keyboard.press("Control+Alt+ArrowLeft");
  await expect(second).toBeVisible();
  await expect(second.locator(".xterm-helper-textarea")).toBeFocused();
  await page.getByRole("tab", { name: /Workflows/ }).click();
  await page.getByRole("button", { name: "Collapse agents and workflows" }).click();
  await page.keyboard.press("Control+Alt+ArrowRight");
  await expect(first).toBeVisible();
  await expect(first.locator(".xterm-helper-textarea")).toBeFocused();
});

test("launches agents directly into the right panel and switches their terminals", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Run agent" }).click();
  const first = page.getByTestId("agent-dock-panel-agent1");
  await expect(first).toBeVisible();
  await expect(page.locator(".agent-window")).toHaveCount(0);
  await page.getByTestId("agent-terminal-agent1").evaluate((node) => node.setAttribute("data-e2e-mark", "original"));
  await page.getByRole("button", { name: "Run agent" }).click();
  await expect(page.getByTestId("agent-dock-panel-agent2")).toBeVisible();
  await expect(first).toBeHidden();
  await page.getByRole("button", { name: "Select agent" }).click();
  await page.getByRole("option", { name: /agent1/ }).click();
  await expect(first).toBeVisible();
  await expect(page.getByTestId("agent-terminal-agent1")).toHaveAttribute("data-e2e-mark", "original");
  await expect(page.getByRole("button", { name: /Detach/ })).toHaveCount(0);
});

test("keeps terminals mounted while changing tabs, collapsing and switching worktrees", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Run agent" }).click();
  const terminal = page.getByTestId("agent-terminal-agent1");
  await terminal.evaluate((node) => node.setAttribute("data-e2e-mark", "original"));
  await page.getByRole("tab", { name: /Workflows/ }).click();
  await expect(page.getByRole("button", { name: "Run agent" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run workflow" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse agents and workflows" }).click();
  await expect(terminal).toBeAttached();
  await page.getByRole("button", { name: "Expand agents and workflows" }).click();
  await page.getByRole("tab", { name: /Agents/ }).click();
  await page.getByTestId("worktree-add").click();
  await page.getByRole("tab", { name: "wt-1", exact: true }).click();
  await expect(terminal).toBeVisible();
  await expect(terminal).toHaveAttribute("data-e2e-mark", "original");
});

test("closing an attached agent removes it and respects agent capacity", async ({ page }) => {
  await gotoApp(page);
  const run = page.getByRole("button", { name: "Run agent" });
  for (let i = 1; i <= 5; i++) {
    await run.click();
    await expect(page.getByTestId(`agent-dock-panel-agent${i}`)).toBeVisible();
  }
  await expect(run).toBeDisabled();
  await page.getByRole("button", { name: "Close agent5", exact: true }).click();
  await expect(page.getByTestId("agent-dock-panel-agent5")).toHaveCount(0);
  await expect(run).toBeEnabled();
  await expect(page.getByTestId("agent-layer")).toHaveAttribute("data-active-workspace", "main");
});

test("creates a workflow in the editor and collapses the steps while chatting", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("tab", { name: /Workflows/ }).click();
  await page.getByRole("button", { name: "All workflows", exact: true }).click();
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Workflow editor" });
  await editor.getByLabel("Workflow name").fill("Inspect project");
  await editor.getByRole("textbox", { name: /^Instructions/ }).fill("Inspect the project and summarize its structure.");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Run Inspect project", exact: true }).click();
  await expect(page.getByTestId("step-rail").getByRole("listitem")).toHaveCount(1);
  await page.getByTestId("chat-input").focus();
  await expect(page.getByTestId("step-rail-collapsed")).toBeVisible();
});
