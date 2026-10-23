import type { Locator, Page } from "@playwright/test";

/** Clicks a hierarchy label in the Project Tree, not similarly named diagram content. */
export async function clickTreeNodeName(page: Page, name: string): Promise<void> {
  await page.getByTestId("left-panel-files").getByText(name, { exact: true }).click();
}

export function treeNode(page: Page, nodeId: string): Locator {
  return page
    .getByTestId("left-panel-files")
    .locator(`[data-testid="tree-node"][data-node-id="${nodeId}"]`);
}

// Disables first-load auto-expand so interaction specs begin with a known-collapsed Project Tree;
// opens the left panel's Files tab (the tree's home) unless `files: false`.
export async function gotoApp(page: Page, opts: { files?: boolean } = {}): Promise<void> {
  await page.goto("/?autoexpand=off");
  await page.waitForSelector('[data-testid="app-root"]');
  if (opts.files ?? true) await page.getByRole("tab", { name: "Files", exact: true }).click();
}

// Starts a run of a saved workflow: saved workflows live on the All workflows screen (header list button).
export async function startSavedRun(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name: /Workflows/ }).click();
  await page.getByRole("button", { name: "All workflows", exact: true }).click();
  await page.getByRole("button", { name: `Run ${name}`, exact: true }).click();
}
