import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Global "Diff" toggle (mock bridge backend): first click reveals every changed function's box
// with a before/after diff AND frames them on screen; second click restores the previous view —
// the ancestors it expanded collapse and the code boxes it opened close.
// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("Diff button reveals changed functions on screen, and toggling it off restores the previous view", async ({
  page,
}) => {
  await gotoApp(page);

  const diffButton = page.getByRole("button", { name: "Show diff vs last commit" });
  await diffButton.click();

  const diffView = page.getByTestId("diff-view").first();
  await expect(diffView).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide diff, keep code open" })).toBeVisible();

  // The regression this fixes: the revealed diff must actually land inside the canvas window,
  // not below the fold or past the right edge.
  const canvasBox = await page.getByTestId("canvas-area").boundingBox();
  const diffBox = await diffView.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(diffBox).not.toBeNull();
  expect(diffBox!.y + diffBox!.height).toBeGreaterThan(canvasBox!.y);
  expect(diffBox!.y).toBeLessThan(canvasBox!.y + canvasBox!.height);
  expect(diffBox!.x).toBeLessThan(canvasBox!.x + canvasBox!.width);

  await page.getByRole("button", { name: "Hide diff, keep code open" }).click();

  // Previous view restored: no diffs, and none of the code boxes the reveal opened are left open.
  await expect(page.getByTestId("diff-view")).toHaveCount(0);
  await expect(page.getByTestId("block-code-view")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show diff vs last commit" })).toBeVisible();
});
