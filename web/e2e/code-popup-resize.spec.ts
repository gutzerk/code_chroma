import { test, expect } from "@playwright/test";
import { gotoApp, clickTreeNodeName } from "./helpers";

// The code popup opens content-sized (styles.css), capped at ~95% of the viewport. Its
// bottom-right corner handle still lets the user fine-tune that window — grow or shrink it — up to
// that same ~95% ceiling.
// Skipped: the rail button this test used to switch into popup mode ("Switch code view to popup
// mode") was repurposed into the code-tree show/hide toggle (RootCanvas.tsx); codeViewModeStore
// itself still exists (see codeViewModeStore.test.ts), it just has no rail button any more.
test.skip("dragging the popup's corner handle grows it past its default size", async ({ page }) => {
  await gotoApp(page);

  // Inline is now the default; switch to popup mode to exercise the popup window.
  await page.getByRole("button", { name: "Switch code view to popup mode" }).click();

  const viewport = page.getByTestId("app-canvas");
  for (const name of ["examples", "shadow-app", "backend", "domain", "order_service.py"]) {
    await clickTreeNodeName(page, name);
    await page.waitForTimeout(150); // let each expand's auto-fit settle before the next click
  }
  await expect(viewport.getByText("calculate_total", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Show code for calculate_total" }).click();
  const popup = page.getByTestId("code-popup");
  await expect(popup).toBeVisible();

  const boxBefore = await popup.boundingBox();
  if (!boxBefore) throw new Error("code popup not found");

  const handle = page.getByTestId("code-popup-resize-handle");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("resize handle not found");

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 200,
    handleBox.y + handleBox.height / 2 + 150,
    { steps: 5 },
  );
  await page.mouse.up();

  const boxAfter = await popup.boundingBox();
  if (!boxAfter) throw new Error("code popup disappeared after resize");

  expect(boxAfter.width).toBeGreaterThan(boxBefore.width + 150);
  expect(boxAfter.height).toBeGreaterThan(boxBefore.height + 100);
});
