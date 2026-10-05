import { test, expect } from "@playwright/test";
import { clickTreeNodeName, gotoApp, treeNode } from "./helpers";

// root -> folder -> folder -> folder -> file: expanding in place never navigates (FR-002-FR-004),
// and every ancestor along the path stays expanded simultaneously (FR-003, FR-004).
test("expands in place from root down to a leaf with no navigation", async ({ page }) => {
  await gotoApp(page);
  const urlBefore = page.url();

  await clickTreeNodeName(page, "examples"); // root folder
  await clickTreeNodeName(page, "shadow-app"); // folder
  await clickTreeNodeName(page, "backend"); // folder
  await clickTreeNodeName(page, "clients"); // folder

  expect(page.url()).toBe(urlBefore);
  await expect(treeNode(page, "file::shadow-app/backend/clients/email_client.py")).toBeVisible();

  for (const nodeId of [
    "root",
    "folder::shadow-app",
    "folder::shadow-app/backend",
    "folder::shadow-app/backend/clients",
  ]) {
    await expect(treeNode(page, nodeId)).toHaveAttribute("data-expand-state", "expanded");
  }

  // Activating a source file opens it in the code sidebar; it does not expand the file into another
  // hierarchy level or navigate away from the current tree.
  await clickTreeNodeName(page, "email_client.py");
  const fileRow = treeNode(page, "file::shadow-app/backend/clients/email_client.py");
  await expect(fileRow).toHaveClass(/tree-node-active/);
  await expect(page.getByTestId("code-sidebar")).toBeVisible();
  await expect(fileRow).toHaveAttribute("data-expand-state", "collapsed");
  expect(page.url()).toBe(urlBefore);
  await expect(treeNode(page, "folder::shadow-app/backend/clients")).toHaveAttribute(
    "data-expand-state",
    "expanded",
  );
});
