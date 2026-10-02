import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Diff mode's corner "Accept" button (mock bridge backend): clicking it commits that one diffed
// node, which the mock simulates by omitting it from every later getDiff() call — so its panel
// disappears while diff mode itself stays active and any other diffed panel is left untouched.
// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("Accept commits one diffed node and its panel disappears, leaving the rest of diff mode active", async ({
  page,
}) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Show diff vs last commit" }).click();

  const diffViews = page.getByTestId("diff-view");
  await expect(diffViews.first()).toBeVisible();
  const countBefore = await diffViews.count();
  expect(countBefore).toBeGreaterThan(1);

  const firstAcceptButton = diffViews.first().getByTestId("diff-accept-button");
  await firstAcceptButton.click();

  await expect(diffViews).toHaveCount(countBefore - 1);
  // Diff mode itself stays on — accepting one node isn't the same as toggling Diff off.
  await expect(page.getByRole("button", { name: "Hide diff, keep code open" })).toBeVisible();
});
