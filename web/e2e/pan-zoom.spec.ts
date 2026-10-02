import { test, expect } from "@playwright/test";
import { gotoApp, clickBlockName } from "./helpers";

// Miro-style canvas viewport: scroll-wheel zooms toward the cursor and dragging empty canvas
// space pans, both applied as a single CSS transform on `.canvas-content` (never by moving or
// hiding individual blocks).
test("zooms toward the cursor on wheel and pans on drag", async ({ page }) => {
  await gotoApp(page);

  const content = page.getByTestId("canvas-content");
  const viewport = page.getByTestId("app-canvas");
  const box = await viewport.boundingBox();
  if (!box) throw new Error("canvas viewport not found");

  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200); // scroll up = zoom in
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(initialTransform);

  const afterZoomTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  // Drag from one empty corner of the canvas to another (away from the single collapsed root
  // block) to pan.
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 120, box.y + box.height - 120, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(afterZoomTransform);
});

// Regression: an expanded block's box is mostly empty padding wrapping its children, so a
// press-and-drag that starts over a block must pan the canvas (it used to be swallowed because the
// pointer landed inside a [data-node-id] element) — while a plain click on that same block still
// toggles it. Here we drag over the block's own header and assert both: the view pans, and the
// drag does not toggle the block open.
test("dragging over a block pans the canvas without toggling that block", async ({ page }) => {
  // Boxes renderer: this asserts a `.block`'s own header/focus-button geometry.
  await gotoApp(page, { strategy: "boxes" });

  const content = page.getByTestId("canvas-content");
  const block = page.getByTestId("app-canvas").getByTestId("block").first();
  await expect(block).toHaveAttribute("data-expand-state", "collapsed");

  const blockBox = await block.boundingBox();
  if (!blockBox) throw new Error("block not found");
  const startX = blockBox.x + blockBox.width / 2;
  const startY = blockBox.y + 12; // over the header row, well inside the block

  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 140, startY + 100, { steps: 6 });
  await page.mouse.up();

  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(initialTransform);
  // The drag must not have counted as a click — the block stays collapsed.
  await expect(block).toHaveAttribute("data-expand-state", "collapsed");
});

test("Ctrl+wheel (trackpad pinch) zooms the canvas without moving the top chrome or Fit All button", async ({
  page,
}) => {
  await gotoApp(page);

  const content = page.getByTestId("canvas-content");
  const viewport = page.getByTestId("app-canvas");
  const chrome = page.getByTestId("app-chrome");
  const fitAllButton = page.getByRole("button", { name: "Fit all open blocks" });

  const box = await viewport.boundingBox();
  if (!box) throw new Error("canvas viewport not found");

  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);
  const chromeBoxBefore = await chrome.boundingBox();
  const fitAllBoxBefore = await fitAllButton.boundingBox();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200); // Ctrl+scroll = the input browsers treat as native pinch-zoom
  await page.keyboard.up("Control");

  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(initialTransform);

  // The browser's own native zoom must never engage here — only `.canvas-content` should have
  // moved. If it did (e.g. preventDefault() silently failing on a passive wheel listener), these
  // "fixed to the screen" elements would drift right along with it.
  expect(await chrome.boundingBox()).toEqual(chromeBoxBefore);
  expect(await fitAllButton.boundingBox()).toEqual(fitAllBoxBefore);
});

test("zoom buttons and reset control the canvas scale", async ({ page }) => {
  await gotoApp(page);

  const content = page.getByTestId("canvas-content");
  // Two top-level boxes now (see fixtures.ts): the second's x depends on the first's measured
  // width, so the initial centering can still be correcting itself for a few frames after mount
  // (RootCanvas.tsx's CAMERA_RECENTER_MAX_FRAMES retries). Wait it out before capturing the
  // baseline, so this isn't racing that same settle.
  await page.waitForTimeout(1000);
  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(initialTransform);

  await page.getByRole("button", { name: "Reset zoom" }).click();
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .toBe(initialTransform);
});

test("focus button centers a block and scales it to fill the viewport", async ({ page }) => {
  // Boxes renderer: this asserts a `.block`'s own header/focus-button geometry.
  await gotoApp(page, { strategy: "boxes" });

  const content = page.getByTestId("canvas-content");
  const viewport = page.getByTestId("app-canvas");
  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  const rootBlock = viewport.getByTestId("block").first();
  await rootBlock.getByRole("button", { name: /Center /i }).click();

  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(initialTransform);

  // Wait for the focus transition (550ms) to settle before measuring the final box.
  await page.waitForTimeout(650);

  const viewportBox = await viewport.boundingBox();
  const blockBox = await rootBlock.boundingBox();
  if (!viewportBox || !blockBox) throw new Error("viewport or block not found");

  // The focused block should now cover roughly 70% of the viewport (FOCUS_FIT_PADDING), not
  // fill it edge-to-edge and not stay small — check a band around that target instead of a
  // loose lower bound.
  expect(blockBox.width).toBeGreaterThan(viewportBox.width * 0.6);
  expect(blockBox.width).toBeLessThan(viewportBox.width * 0.8);
});

test("clicking a block's focus button again returns to the view from before it was focused", async ({
  page,
}) => {
  // Boxes renderer: this asserts a `.block`'s own header/focus-button geometry.
  await gotoApp(page, { strategy: "boxes" });

  const content = page.getByTestId("canvas-content");
  const viewport = page.getByTestId("app-canvas");
  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  const rootBlock = viewport.getByTestId("block").first();
  const focusButton = rootBlock.getByRole("button", { name: /Center /i });

  await focusButton.click();
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(initialTransform);

  await focusButton.click();
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .toBe(initialTransform);
});

test("Fit All button fits the whole expanded tree without ever moving itself", async ({ page }) => {
  await gotoApp(page);

  const content = page.getByTestId("canvas-content");
  const viewport = page.getByTestId("app-canvas");
  const fitAllButton = page.getByRole("button", { name: "Fit all open blocks" });
  const fitAllBoxBefore = await fitAllButton.boundingBox();

  await clickBlockName(page, "examples");
  await expect(viewport.getByText("shadow-app", { exact: true })).toBeVisible();
  await clickBlockName(page, "shadow-app");
  await expect(viewport.getByText("backend", { exact: true })).toBeVisible();

  // Auto-fit already fills the viewport edge-to-edge after those expands (leaving no empty
  // corner to safely drag-pan from without landing on a block), so move the view away via the
  // existing Reset button instead — it's a real transform change with no click-target risk.
  await page.getByRole("button", { name: "Reset zoom" }).click();
  const transformAfterReset = await content.evaluate((el) => getComputedStyle(el).transform);

  await fitAllButton.click();
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(transformAfterReset);

  // Fit All lives outside the pannable `.canvas-content`, so panning/zooming never moves it.
  const fitAllBoxAfter = await fitAllButton.boundingBox();
  expect(fitAllBoxAfter).toEqual(fitAllBoxBefore);

  // The whole expanded tree (root through backend) should now be visible on screen.
  await expect(viewport.getByText("examples", { exact: true })).toBeVisible();
  await expect(viewport.getByText("shadow-app", { exact: true })).toBeVisible();
  await expect(viewport.getByText("backend", { exact: true })).toBeVisible();
});

test("expanding a block automatically re-fits the whole tree, without clicking Fit All", async ({
  page,
}) => {
  await gotoApp(page);

  const content = page.getByTestId("canvas-content");
  const viewport = page.getByTestId("app-canvas");
  // Wait for the initial "center root on load" effect to settle before taking the baseline.
  await page.waitForTimeout(100);
  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  await clickBlockName(page, "examples");

  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(initialTransform);

  await expect(viewport.getByText("shadow-app", { exact: true })).toBeVisible();
});

test("collapsing a block also automatically re-fits, without clicking Fit All", async ({ page }) => {
  await gotoApp(page);

  const content = page.getByTestId("canvas-content");
  const viewport = page.getByTestId("app-canvas");

  await clickBlockName(page, "examples");
  await expect(viewport.getByText("shadow-app", { exact: true })).toBeVisible();
  await page.waitForTimeout(650); // let the expand's own auto-fit settle first

  const transformExpanded = await content.evaluate((el) => getComputedStyle(el).transform);

  // Collapsing "examples" again shrinks the tree back down to a single block.
  await clickBlockName(page, "examples");

  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(transformExpanded);
});
