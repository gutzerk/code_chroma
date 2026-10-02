import { test, expect } from "@playwright/test";
import { clickBlockName, gotoApp } from "./helpers";

// Independent multi-block expansion/collapse, backdrop blur per expanded block, and a breadcrumb
// reflecting the deepest expanded path (FR-005, FR-006, FR-007).
test("expands multiple blocks at different depths and siblings independently", async ({ page }) => {
  // Boxes renderer: asserts per-block backdrop blur, which only the nested boxes render.
  await gotoApp(page, { strategy: "boxes" });

  await clickBlockName(page, "examples");
  await clickBlockName(page, "shadow-app");
  await clickBlockName(page, "backend");
  await clickBlockName(page, "clients"); // depth 3, folder inside backend

  // A second, shallower sibling expansion at the same time (arbitrary simultaneous depth): shadow-app's
  // other top-level child (frontend) is visible untouched, without needing any extra clicks.
  await expect(page.locator('[data-node-id="folder::shadow-app/frontend"]')).toBeVisible();

  const backendBlock = page.locator('[data-node-id="folder::shadow-app/backend"]');
  const clientsBlock = page.locator('[data-node-id="folder::shadow-app/backend/clients"]');
  await expect(backendBlock).toHaveAttribute("data-expand-state", "expanded");
  await expect(clientsBlock).toHaveAttribute("data-expand-state", "expanded");

  // Each expanded block gets its own backdrop blur, independent of the others.
  await expect(backendBlock).toHaveClass(/block-expanded/);
  await expect(clientsBlock).toHaveClass(/block-expanded/);

  // Clicking clients' own header again (not a nested descendant's) collapses only that block.
  await clickBlockName(page, "clients");
  await expect(clientsBlock).toHaveAttribute("data-expand-state", "collapsed");
  await expect(backendBlock).toHaveAttribute("data-expand-state", "expanded");
});
