import { test, expect, type Page } from "@playwright/test";
import { gotoApp, startSavedRun } from "./helpers";

// Sizes from the workflow design boards (8 stretched panel, 9 full screen, 11 All workflows), on the mock engine.
async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} is not visible`);
  return b;
}

test("stretched panel: 280px run list beside the run, 34px actions, 28px step nodes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);
  await page.getByRole("button", { name: "Stretch panel" }).first().click();
  await startSavedRun(page, "Ship a feature");

  expect((await box(page, ".wf-list-col")).width).toBeCloseTo(280, 0);
  expect((await box(page, '[data-testid="header-toggle"]')).height).toBe(34);
  const node = await box(page, ".step-number");
  expect([node.width, node.height]).toEqual([28, 28]);
  const segment = await box(page, ".wf-seg span");
  expect(segment.height).toBe(4);
});

test("full screen: 300 / 520 / live columns, a 320px tab list and the live Agent tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);
  await startSavedRun(page, "Ship a feature");
  await page.getByRole("button", { name: "Full screen" }).first().click();

  expect((await box(page, ".wf-list-col")).width).toBeCloseTo(300, 0);
  expect((await box(page, ".wf-run-col")).width).toBeCloseTo(520, 0);
  expect((await box(page, '[role="tablist"][aria-label="Activity"]')).width).toBeCloseTo(320, 0);
  expect((await box(page, '[data-testid="run-workflow"]')).height).toBe(36);
  await expect(page.getByTestId("live-tab-agent")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible();
});

test("All workflows: five-column table, search, New workflow and the row menu", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);
  await page.getByRole("tab", { name: /Workflows/ }).click();
  await page.getByRole("button", { name: "Full screen" }).first().click();
  await page.getByRole("button", { name: "All workflows", exact: true }).click();

  await expect(page.getByRole("columnheader")).toHaveText(["Workflow", "Steps", "Inputs", "Last run", "Actions"]);
  await expect(page.getByRole("button", { name: /New workflow/ })).toBeVisible();
  expect((await box(page, ".wf-search")).width).toBeCloseTo(320, 0);
  await page.getByRole("button", { name: "More actions for Ship a feature" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Duplicate", "Rename", "Delete"]);
});

test("hand-dragging the panel wide switches to the side layout, and past the limit goes full screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);
  await startSavedRun(page, "Ship a feature");
  const handle = await box(page, '[data-testid="activity-resize-handle"]');
  const y = handle.y + handle.height / 2;
  const x = handle.x + handle.width / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 400, y, { steps: 8 });
  await expect(page.getByTestId("activity-panel")).toHaveAttribute("data-size", "side");
  expect((await box(page, ".wf-list-col")).width).toBeCloseTo(280, 0);
  await page.mouse.move(x - 900, y, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible();
  await expect(page.getByTestId("activity-panel")).toHaveAttribute("data-size", "full");
});
