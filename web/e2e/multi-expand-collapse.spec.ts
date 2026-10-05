import { test, expect } from "@playwright/test";
import { clickTreeNodeName, gotoApp, treeNode } from "./helpers";

// Independent expansion/collapse at different depths remains available in the Project Tree.
test("expands multiple tree rows at different depths and siblings independently", async ({ page }) => {
  await gotoApp(page);

  await clickTreeNodeName(page, "examples");
  await clickTreeNodeName(page, "shadow-app");
  await clickTreeNodeName(page, "backend");
  await clickTreeNodeName(page, "clients");

  await expect(treeNode(page, "folder::shadow-app/frontend")).toBeVisible();

  const backendRow = treeNode(page, "folder::shadow-app/backend");
  const clientsRow = treeNode(page, "folder::shadow-app/backend/clients");
  await expect(backendRow).toHaveAttribute("data-expand-state", "expanded");
  await expect(clientsRow).toHaveAttribute("data-expand-state", "expanded");

  await clickTreeNodeName(page, "clients");
  await expect(clientsRow).toHaveAttribute("data-expand-state", "collapsed");
  await expect(backendRow).toHaveAttribute("data-expand-state", "expanded");
});
