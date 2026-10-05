import { test, expect } from "@playwright/test";
import { clickTreeNodeName, gotoApp, treeNode } from "./helpers";

test("opening a source file shows its code without expanding the file row", async ({ page }) => {
  await gotoApp(page);

  for (const name of ["examples", "shadow-app", "backend", "domain"]) {
    await clickTreeNodeName(page, name);
  }
  await clickTreeNodeName(page, "order_service.py");

  await expect(page.getByTestId("code-sidebar")).toBeVisible();
  await expect(page.getByTestId("block-code-view")).toBeVisible();
  const fileRow = treeNode(page, "file::shadow-app/backend/domain/order_service.py");
  await expect(fileRow).toHaveClass(/tree-node-active/);
  await expect(fileRow).toHaveAttribute("data-expand-state", "collapsed");
});

test("opening the code sidebar keeps the canvas stage within its flex row", async ({ page }) => {
  await gotoApp(page);

  const tree = page.getByTestId("project-tree-panel");
  for (const name of ["examples", "shadow-app", "backend", "domain", "order_service.py"]) {
    await tree.getByText(name, { exact: true }).click();
    await page.waitForTimeout(150);
  }

  await expect(page.getByTestId("code-sidebar")).toBeVisible();
  await expect(page.getByTestId("block-code-view")).toBeVisible();
  await expect(page.getByTestId("block-code-view-source")).toHaveCSS("scrollbar-width", "thin");

  const stage = page.locator(".canvas-stage");
  await expect(stage).toHaveCSS("min-width", "0px");
  const stageRight = await stage.evaluate((element) => element.getBoundingClientRect().right);
  const rowRight = await page
    .locator(".canvas-main-row")
    .evaluate((element) => element.getBoundingClientRect().right);
  expect(stageRight).toBeLessThanOrEqual(rowRight + 1);
});
