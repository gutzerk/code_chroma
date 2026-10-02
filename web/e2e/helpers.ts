import type { Page } from "@playwright/test";

/** Clicks a block's own name label within the canvas — scoped there (not the breadcrumb, which
 * can show the same name) so a click never lands on a nested descendant's label once several
 * levels are expanded at once (research.md Decision 1: a block's own header always sits above
 * its children in the DOM, never covered by them). */
export async function clickBlockName(page: Page, name: string): Promise<void> {
  await page.getByTestId("app-canvas").getByText(name, { exact: true }).click();
}

/** Which hierarchy renderer a spec asserts against — `tree` is the app default, `boxes` the other. */
export type CanvasStrategy = "boxes" | "tree";

// Disables first-load auto-expand so these specs drive expand/collapse from a known-collapsed start.
// The auto-expand feature itself is covered by auto-expand.spec.ts (which loads with it enabled).
// `strategy` pins the renderer for specs that assert one renderer's DOM (nested `.block` boxes vs
// indented `.tree-node` rows), so flipping the app's default can never silently break them again.
export async function gotoApp(
  page: Page,
  options: { strategy?: CanvasStrategy } = {},
): Promise<void> {
  const params = new URLSearchParams({ autoexpand: "off" });
  if (options.strategy) params.set("strategy", options.strategy);
  await page.goto(`/?${params}`);
  await page.waitForSelector('[data-testid="app-root"]');
}
