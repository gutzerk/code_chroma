import { test, expect } from "@playwright/test";
import { clickTreeNodeName, gotoApp, treeNode } from "./helpers";

test("modifier-clicking a Project Tree row expands it without selecting a canvas box", async ({
  page,
}) => {
  await gotoApp(page);
  await clickTreeNodeName(page, "examples");
  await clickTreeNodeName(page, "shadow-app");

  const backend = treeNode(page, "folder::shadow-app/backend");
  await expect(backend).toHaveAttribute("data-expand-state", "collapsed");
  await backend.getByTestId("tree-node-label").click({ modifiers: ["Shift"] });

  await expect(backend).toHaveAttribute("data-expand-state", "expanded");
  await expect(backend).not.toHaveClass(/block-selected/);
  await expect(page.getByTestId("canvas-hierarchy-element")).toHaveCount(0);
});
