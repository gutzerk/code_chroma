import { test, expect } from "@playwright/test";
import { clickTreeNodeName, gotoApp, treeNode } from "./helpers";

test("expanding the Project Tree does not add hierarchy boxes to the diagrams canvas", async ({
  page,
}) => {
  await gotoApp(page);
  const hierarchyElement = page.getByTestId("canvas-hierarchy-element");

  await expect(page.getByTestId("project-tree-panel")).toBeVisible();
  await expect(hierarchyElement).toHaveCount(0);

  await clickTreeNodeName(page, "examples");

  await expect(treeNode(page, "folder::shadow-app")).toBeVisible();
  await expect(hierarchyElement).toHaveCount(0);
});
