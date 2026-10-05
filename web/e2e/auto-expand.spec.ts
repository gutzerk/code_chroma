import { test, expect } from "@playwright/test";
import { treeNode } from "./helpers";

// On first load the hierarchy auto-expands in the Project Tree while the canvas stays diagrams-only.
test("auto-expands the Project Tree on first load", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="app-root"]');

  for (const nodeId of [
    "root",
    "folder::shadow-app",
    "folder::shadow-app/backend",
    "folder::shadow-app/frontend",
  ]) {
    await expect(treeNode(page, nodeId)).toHaveAttribute("data-expand-state", "expanded");
  }

  // Files are revealed in the sidebar but remain collapsed.
  await expect(treeNode(page, "file::shadow-app/backend/main.py")).toHaveAttribute(
    "data-expand-state",
    "collapsed",
  );
  await expect(page.getByTestId("canvas-hierarchy-element")).toHaveCount(0);
});
