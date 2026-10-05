import { test, expect } from "@playwright/test";
import { clickTreeNodeName, gotoApp } from "./helpers";

test("zooms toward the cursor on wheel and pans on drag", async ({ page }) => {
  await gotoApp(page);

  const content = page.getByTestId("canvas-content");
  const viewport = page.getByTestId("app-canvas");
  const box = await viewport.boundingBox();
  if (!box) throw new Error("canvas viewport not found");

  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(initialTransform);

  const afterZoomTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 120, box.y + box.height - 120, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(afterZoomTransform);
});

test("expanding the Project Tree does not move the diagrams canvas", async ({ page }) => {
  await gotoApp(page);

  const content = page.getByTestId("canvas-content");
  await expect(page.getByTestId("canvas-hierarchy-element")).toHaveCount(0);
  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);

  await clickTreeNodeName(page, "examples");
  await expect(page.getByTestId("project-tree-panel").getByText("shadow-app")).toBeVisible();

  await expect(content).toHaveCSS("transform", initialTransform);
});

test("Ctrl+wheel zooms the canvas without moving the top chrome or Fit All button", async ({
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
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");

  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(initialTransform);

  expect(await chrome.boundingBox()).toEqual(chromeBoxBefore);
  expect(await fitAllButton.boundingBox()).toEqual(fitAllBoxBefore);
});

test("zoom buttons and reset control the canvas scale", async ({ page }) => {
  await gotoApp(page);

  const content = page.getByTestId("canvas-content");
  await page.waitForTimeout(500);
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

test("Fit All is a no-op when no diagrams are on the canvas", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByTestId("canvas-hierarchy-element")).toHaveCount(0);
  await page.waitForTimeout(500);

  const content = page.getByTestId("canvas-content");
  const fitAllButton = page.getByRole("button", { name: "Fit all open blocks" });
  const initialTransform = await content.evaluate((el) => getComputedStyle(el).transform);
  const buttonPosition = await fitAllButton.boundingBox();

  await fitAllButton.click();

  await expect(content).toHaveCSS("transform", initialTransform);
  expect(await fitAllButton.boundingBox()).toEqual(buttonPosition);
});
