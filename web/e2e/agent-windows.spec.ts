import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

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
  await page.getByRole("tab", { name: /agent1/ }).click();
  await expect(first).toBeVisible();
  await expect(page.getByTestId("agent-terminal-agent1")).toHaveAttribute("data-e2e-mark", "original");
  await expect(page.getByRole("button", { name: /Detach/ })).toHaveCount(0);
});

test("keeps terminals mounted while changing tabs, collapsing and switching branches", async ({ page }) => {
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
  await page.getByTestId("branch-switcher-button").click();
  await page.getByTestId("branch-switcher-list").getByRole("button", { name: "feature-x", exact: true }).click();
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

test("creates a workflow from the run picker and keeps progress visible when steps collapse", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("tab", { name: /Workflows/ }).click();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  const picker = page.locator(".workflow-picker");
  await picker.getByRole("button", { name: /Add new workflow/ }).click();
  await picker.getByLabel("Name", { exact: true }).fill("Inspect project");
  await picker.getByLabel("Instructions").fill("Inspect the project and summarize its structure.");
  await picker.getByRole("button", { name: "Save workflow" }).click();
  await page.getByRole("button", { name: "Start run: Inspect project" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "1");
  await page.getByRole("button", { name: /Hide steps/ }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByTestId("step-rail-collapsed")).toBeVisible();
});
