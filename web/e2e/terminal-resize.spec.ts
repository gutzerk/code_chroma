import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test("terminal tabs remain usable below the resized diagrams panel", async ({ page }, testInfo) => {
  await gotoApp(page, { files: false });
  await page.getByRole("button", { name: "Open terminal panel" }).click();
  const terminal = page.getByTestId("terminal-panel");
  const diagrams = page.getByTestId("left-panel");
  const expectClearance = async () => {
    const panelBox = (await diagrams.boundingBox())!;
    const terminalBox = (await terminal.boundingBox())!;
    expect(panelBox.y + panelBox.height).toBeLessThan(terminalBox.y);
  };
  await expect(expectClearance).toPass();
  const handle = (await page.getByTestId("terminal-panel-resize-handle").boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 100, { steps: 5 });
  await page.mouse.up();
  await expect(expectClearance).toPass();
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Terminal 2" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("terminal-tabs.png") });
  await page.getByRole("tab", { name: "Terminal 1" }).click();
  await expect(terminal.locator(".xterm")).toHaveCount(2);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(terminal.locator(".xterm")).toHaveCount(1);
  await page.getByRole("button", { name: "Hide terminal panel", exact: true }).click();
  await expect(terminal).toBeHidden();
  await page.getByRole("button", { name: "Open terminal panel" }).click();
  await expect(page.getByRole("tab", { name: "Terminal 2" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(terminal).toBeHidden();
  await page.getByRole("button", { name: "Open terminal panel" }).click();
  await expect(page.getByRole("tab", { name: "Terminal 3" })).toBeVisible();
});

// The terminal is a bottom dock (it moved out of the right edge so the C1 inspector could own the
// full window height). It opens at its default 280px height (styles.css); its top-edge handle lets
// the user make it taller — dragging up grows the bottom-anchored panel — up to 60% of the viewport
// height, and never below 160px.
test("dragging the terminal panel's top-edge handle grows it up to 60% of the viewport", async ({
  page,
}) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Open terminal panel" }).click();
  const panel = page.getByTestId("terminal-panel");
  await expect(panel).toBeVisible();

  const boxBefore = await panel.boundingBox();
  if (!boxBefore) throw new Error("terminal panel not found");

  const handle = page.getByTestId("terminal-panel-resize-handle");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("resize handle not found");

  const handleY = handleBox.y + handleBox.height / 2;
  const handleX = handleBox.x + handleBox.width / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX, handleY - 120, { steps: 5 });
  await page.mouse.up();

  const boxAfter = await panel.boundingBox();
  if (!boxAfter) throw new Error("terminal panel disappeared after resize");
  expect(boxAfter.height).toBeGreaterThan(boxBefore.height + 90);

  // Drag far past 60% and confirm the height is capped there.
  await page.mouse.move(handleX, handleY - 120);
  await page.mouse.down();
  await page.mouse.move(handleX, 0, { steps: 5 });
  await page.mouse.up();

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport size");
  const boxCapped = await panel.boundingBox();
  if (!boxCapped) throw new Error("terminal panel disappeared after cap drag");
  expect(boxCapped.height).toBeLessThanOrEqual(viewport.height * 0.6 + 2);
});

// The canvas viewport shrinks to the space above the bottom dock; it does not extend under it.
test("growing the terminal panel keeps the canvas viewport above the dock", async ({ page }) => {
  await gotoApp(page);

  const canvas = page.getByTestId("app-canvas");
  const canvasBefore = await canvas.boundingBox();
  if (!canvasBefore) throw new Error("canvas viewport not found");

  await page.getByRole("button", { name: "Open terminal panel" }).click();
  const terminal = page.getByTestId("terminal-panel");
  await expect(terminal).toBeVisible();

  const handle = page.getByTestId("terminal-panel-resize-handle");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("resize handle not found");
  const handleY = handleBox.y + handleBox.height / 2;
  const handleX = handleBox.x + handleBox.width / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX, handleY - 120, { steps: 5 });
  await page.mouse.up();

  const canvasAfter = await canvas.boundingBox();
  const terminalBox = await terminal.boundingBox();
  if (!canvasAfter || !terminalBox) throw new Error("canvas or terminal panel disappeared");
  expect(canvasAfter.height).toBeLessThan(canvasBefore.height);
  expect(canvasAfter.y).toBeCloseTo(canvasBefore.y, 0);
  const gap = await page.getByTestId("canvas-area").evaluate((node) => parseFloat(getComputedStyle(node).rowGap));
  expect(canvasAfter.y + canvasAfter.height).toBeCloseTo(terminalBox.y - gap, 0);
});

// Growing the panel must reflow the xterm grid to more rows (like a real terminal window), not leave
// the content at its original size. The screen element's height tracks row count.
test("growing the terminal panel reflows the xterm grid to the new height", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Open terminal panel" }).click();
  const screen = page.locator(".xterm-screen");
  await expect(screen).toBeVisible();

  const screenBefore = await screen.boundingBox();
  if (!screenBefore) throw new Error("xterm screen not found");

  const handle = page.getByTestId("terminal-panel-resize-handle");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("resize handle not found");

  const handleY = handleBox.y + handleBox.height / 2;
  const handleX = handleBox.x + handleBox.width / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX, handleY - 140, { steps: 5 });
  await page.mouse.up();

  await expect(async () => {
    const screenAfter = await screen.boundingBox();
    expect(screenAfter?.height ?? 0).toBeGreaterThan(screenBefore.height + 90);
  }).toPass();
});
