import { test, expect } from "@playwright/test";
import { clickTreeNodeName, gotoApp, treeNode } from "./helpers";

test("opening a source file shows its code without expanding the file row", async ({ page }) => {
  await gotoApp(page);

  for (const name of ["examples", "shadow-app", "backend", "domain"]) {
    await clickTreeNodeName(page, name);
  }
  await clickTreeNodeName(page, "order_service.py");

  await expect(page.getByTestId("code-overlay")).toBeVisible();
  await expect(page.getByTestId("block-code-view")).toBeVisible();
  const fileRow = treeNode(page, "file::shadow-app/backend/domain/order_service.py");
  await expect(fileRow).toHaveClass(/tree-node-active/);
  await expect(fileRow).toHaveAttribute("data-expand-state", "collapsed");
});

test("the code overlay stays over the agents panel and leaves the canvas stage unaffected", async ({ page }) => {
  await gotoApp(page);
  const stage = page.locator(".canvas-stage");
  const stageBefore = await stage.boundingBox();

  const tree = page.getByTestId("project-tree-panel");
  for (const name of ["examples", "shadow-app", "backend", "domain", "order_service.py"]) {
    await tree.getByText(name, { exact: true }).click();
    await page.waitForTimeout(150);
  }

  const overlay = page.getByTestId("code-overlay");
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId("block-code-view")).toBeVisible();
  await expect(page.getByTestId("block-code-view-source")).toHaveCSS("scrollbar-width", "thin");
  await expect(page.getByTestId("agents-code-overlay").getByTestId("code-overlay")).toBeVisible();
  expect(await stage.boundingBox()).toEqual(stageBefore);
});
