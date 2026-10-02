import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Trace mode replays a recorded run over the canvas: the picker loads a fixture trace, and stepping
// forward advances the highlighted node. Against the mock bridge (default), MOCK_TRACES stands in for
// GET /repos/{id}/traces output — behavior a unit test can't validate against a real layout engine.
// Skipped: the Replay button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("stepping through a loaded trace advances the active node highlight", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Replay an execution trace" }).click();

  const controls = page.getByTestId("trace-controls");
  await expect(controls).toBeVisible();

  await page
    .getByRole("combobox", { name: "Choose a recorded trace" })
    .selectOption("checkout-ok");

  const counter = page.getByTestId("trace-step-counter");
  await expect(counter).toHaveText("1/8");

  // The active node frame draws once the first frame's block is revealed and mounted.
  const overlay = page.getByTestId("trace-flow-overlay");
  await expect(overlay.locator("rect.trace-node-frame--active")).toHaveCount(1);

  await page.getByRole("button", { name: "Step forward" }).click();
  await expect(counter).toHaveText("2/8");
});

// Skipped: the Replay button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("a failed trace surfaces the error and its red culprit node", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Replay an execution trace" }).click();
  await page
    .getByRole("combobox", { name: "Choose a recorded trace" })
    .selectOption("checkout-declined");

  // Play stops on the culprit raise frame for a failed trace, surfacing its error plaque.
  await page
    .getByTestId("trace-controls")
    .getByRole("button", { name: "Play", exact: true })
    .click();

  const plaque = page.getByTestId("trace-error-plaque");
  await expect(plaque).toContainText("ValueError");
  await expect(plaque).toContainText("card declined");
});
