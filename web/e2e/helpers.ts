import type { Locator, Page } from "@playwright/test";

/** Clicks a hierarchy label in the Project Tree, not similarly named diagram content. */
export async function clickTreeNodeName(page: Page, name: string): Promise<void> {
  await page.getByTestId("project-tree-panel").getByText(name, { exact: true }).click();
}

export function treeNode(page: Page, nodeId: string): Locator {
  return page
    .getByTestId("project-tree-panel")
    .locator(`[data-testid="tree-node"][data-node-id="${nodeId}"]`);
}

// Disables first-load auto-expand so interaction specs begin with a known-collapsed Project Tree.
export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/?autoexpand=off");
  await page.waitForSelector('[data-testid="app-root"]');
}
