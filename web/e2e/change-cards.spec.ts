import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// The Diff toggle publishes two layers: the code diffs, and one change card per change a diff panel
// can't carry (a deleted symbol, a non-code file). Each card panel gets a dashed connector frame
// around its block (class names predate the retired Plan overlay's removal; shared markup).
// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("Diff mode pins change cards onto blocks with their own connector frames", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Show diff vs last commit" }).click();

  const panel = page.getByTestId("change-cards-panel").first();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("change-card").first()).toBeVisible();

  const overlay = page.getByTestId("change-connections-overlay");
  await expect(overlay.locator("path.plan-connection-path").first()).toHaveCount(1);

  await page.getByRole("button", { name: "Hide diff, keep code open" }).click();

  await expect(page.getByTestId("change-cards-panel")).toHaveCount(0);
  await expect(overlay.locator("path.plan-connection-path")).toHaveCount(0);
});

// A card whose node already shows a full diff panel is dropped, so the two layers never say the same
// thing twice on one block. MOCK_CHANGE_CARDS deliberately includes a card for the same node the
// mock diff reports as an added class.
// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("a change whose block already shows a diff panel gets no duplicate card", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Show diff vs last commit" }).click();
  await expect(page.getByTestId("diff-view").first()).toBeVisible();

  const texts = await page.getByTestId("change-card").allInnerTexts();
  expect(texts.join(" ")).not.toContain("OrderRepository");
});

// The block-recolor signal (by_node_status) is a plain hierarchy view addition alongside the
// existing cards — a changed block's own border/badge, not just a floating card pointing at it.
// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("Diff mode recolors a changed block, not just a card pointing at it", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Show diff vs last commit" }).click();

  const block = page.locator('[data-node-id="class::UserRepository"]');
  await expect(block).toBeVisible();
  await expect(block).toHaveClass(/block-change--modified/);

  await page.getByRole("button", { name: "Hide diff, keep code open" }).click();

  // The pre-diff snapshot restore collapses whatever the reveal opened, taking the block out of the
  // DOM entirely — same as the change-card panel disappearing in the test above.
  await expect(block).toHaveCount(0);
});

// class::OrderRepository's card is dropped (its node already shows a full diff panel), but the
// block-recolor signal is computed from the same underlying cards before that client-side dedupe —
// so the block still gets colored even with no floating card next to it.
// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("a block with a diff panel still recolors even though its card was dropped", async ({
  page,
}) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Show diff vs last commit" }).click();
  await expect(page.getByTestId("diff-view").first()).toBeVisible();

  const block = page.locator('[data-node-id="class::OrderRepository"]');
  await expect(block).toHaveClass(/block-change--added/);
});

// A PR is just another read-only workspace; the block-recolor signal needs no special-casing to
// work there too, mirroring pr-review.spec.ts's precedent for the diff panel itself.
// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("block recoloring works unchanged when reviewing a pull request", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Review a GitHub pull request" }).click();
  await page.getByTestId("pr-dialog-select").selectOption("7");
  await page.getByTestId("pr-dialog-open").click();
  await page.getByTestId("pr-dialog-dismiss").click();

  await page.getByRole("button", { name: "Show diff vs last commit" }).click();

  const block = page.locator('[data-node-id="class::UserRepository"]');
  await expect(block).toHaveClass(/block-change--modified/);
});

// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("dragging a change-card panel moves its connector with it", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Show diff vs last commit" }).click();
  const panel = page.getByTestId("change-cards-panel").first();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(650); // let the diff-reveal auto-fit transition settle

  const path = page
    .getByTestId("change-connections-overlay")
    .locator("path.plan-connection-path")
    .first();
  const dBefore = await path.getAttribute("d");

  const header = panel.getByTestId("change-cards-panel-header");
  const headerBox = await header.boundingBox();
  if (!headerBox) throw new Error("change-card panel header not found");
  await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    headerBox.x + headerBox.width / 2 + 120,
    headerBox.y + headerBox.height / 2 + 90,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect.poll(() => path.getAttribute("d")).not.toBe(dBefore);
});
