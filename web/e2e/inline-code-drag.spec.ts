import { test, expect } from "@playwright/test";
import { gotoApp, clickBlockName } from "./helpers";

// Inline code panels are draggable by their header, like the popup's title bar. The panel lives
// inside the scaled `.canvas-content`, so this exercises the screen-pixels-to-canvas-units scale
// compensation that unit tests can't validate against a real layout engine.
test("dragging an inline code panel's header moves it by the mouse delta without panning the canvas", async ({
  page,
}) => {
  await gotoApp(page);

  // Inline is the default code view mode, so no toggle is needed here.
  const viewport = page.getByTestId("app-canvas");
  for (const name of ["examples", "shadow-app", "backend", "domain", "order_service.py"]) {
    await clickBlockName(page, name);
    await page.waitForTimeout(150); // let each expand's auto-fit settle before the next click
  }
  await expect(viewport.getByText("calculate_total", { exact: true })).toBeVisible();

  const content = page.getByTestId("canvas-content");
  const transformBeforeShow = await content.evaluate((el) => getComputedStyle(el).transform);

  await page.getByRole("button", { name: "Show code for calculate_total" }).click();
  const panel = page.getByTestId("block-code-view");
  await expect(panel).toBeVisible();

  // Showing code auto-fits the camera onto the now-enlarged block, so it stays fully on screen
  // without a manual "Fit All" click.
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(transformBeforeShow);
  await page.waitForTimeout(650); // let the auto-fit transition settle

  const transformBefore = await content.evaluate((el) => getComputedStyle(el).transform);
  // The deep expansion's auto-fit leaves the canvas at a non-1 scale, so this drag genuinely
  // exercises the divide-by-scale compensation (without it the panel would overshoot/lag).
  const scale = await content.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  expect(scale).not.toBeCloseTo(1, 2);

  const header = page.getByTestId("block-code-view-header");
  const headerBox = await header.boundingBox();
  const panelBoxBefore = await panel.boundingBox();
  if (!headerBox || !panelBoxBefore) throw new Error("inline code panel not found");

  await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    headerBox.x + headerBox.width / 2 + 80,
    headerBox.y + headerBox.height / 2 + 60,
    { steps: 5 },
  );
  await page.mouse.up();

  const panelBoxAfter = await panel.boundingBox();
  if (!panelBoxAfter) throw new Error("inline code panel disappeared after drag");

  // The panel tracks the mouse in screen pixels (small tolerance for subpixel rounding).
  expect(Math.abs(panelBoxAfter.x - panelBoxBefore.x - 80)).toBeLessThan(3);
  expect(Math.abs(panelBoxAfter.y - panelBoxBefore.y - 60)).toBeLessThan(3);

  // The drag repositioned only the panel — it never leaked into a canvas pan.
  const transformAfter = await content.evaluate((el) => getComputedStyle(el).transform);
  expect(transformAfter).toBe(transformBefore);
});

test("opening the code sidebar keeps the canvas stage within its flex row", async ({ page }) => {
  await gotoApp(page);

  const tree = page.getByTestId("project-tree-panel");
  for (const name of ["examples", "shadow-app", "backend", "domain", "order_service.py"]) {
    await tree.getByText(name, { exact: true }).click();
    await page.waitForTimeout(150);
  }

  await expect(page.getByTestId("code-sidebar")).toBeVisible();
  await expect(page.getByTestId("block-code-view")).toBeVisible();
  await expect(page.getByTestId("block-code-view-source")).toHaveCSS("scrollbar-width", "thin");

  const stage = page.locator(".canvas-stage");
  await expect(stage).toHaveCSS("min-width", "0px");
  const stageRight = await stage.evaluate((element) => element.getBoundingClientRect().right);
  const rowRight = await page
    .locator(".canvas-main-row")
    .evaluate((element) => element.getBoundingClientRect().right);
  expect(stageRight).toBeLessThanOrEqual(rowRight + 1);
});
