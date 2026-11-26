import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

const fontSize = (panel: import("@playwright/test").Locator) =>
  panel.locator(".xterm-rows").evaluate((rows) => getComputedStyle(rows).fontSize);

test("A+ grows an agent terminal's text and the size survives a reload", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Run agent" }).click();
  const panel = page.getByTestId("agent-dock-panel-agent1");
  await expect(panel.locator(".xterm-rows")).toBeAttached();
  const before = await fontSize(panel);

  await panel.getByRole("button", { name: "Larger terminal text" }).click();
  await panel.getByRole("button", { name: "Larger terminal text" }).click();

  await expect.poll(() => fontSize(panel)).toBe(`${parseFloat(before) + 2}px`);
  await page.reload();
  await page.getByRole("button", { name: "Run agent" }).click();
  await expect.poll(() => fontSize(page.getByTestId("agent-dock-panel-agent1"))).toBe(`${parseFloat(before) + 2}px`);
});
