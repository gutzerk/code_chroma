import { test, expect } from "@playwright/test";

// On first load (auto-expand enabled by default) the canvas cascades open level by level until at
// least 5 elements are visible, instead of showing a single collapsed root. For the fixture the
// cascade is examples -> shadow-app -> {backend, frontend}, which reveals 9 elements.
// Pinned to the boxes renderer: the assertions below read `[data-testid="block"]`. No gotoApp here
// on purpose — this is the one spec that must load with auto-expand left on.
test("auto-expands the tree on first load until >= 5 elements are visible", async ({ page }) => {
  await page.goto("/?strategy=boxes");
  await page.waitForSelector('[data-testid="app-root"]');

  for (const nodeId of [
    "root",
    "folder::shadow-app",
    "folder::shadow-app/backend",
    "folder::shadow-app/frontend",
  ]) {
    await expect(
      page.locator(`[data-testid="block"][data-node-id="${nodeId}"]`),
    ).toHaveAttribute("data-expand-state", "expanded");
  }

  // Files (terminal for auto-expand) are revealed but never expanded.
  await expect(
    page.locator('[data-testid="block"][data-node-id="file::shadow-app/backend/main.py"]'),
  ).toHaveAttribute("data-expand-state", "collapsed");
});
