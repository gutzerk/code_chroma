import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test("diagram swatches match frame borders in both panel layouts", async ({ page }) => {
  await gotoApp(page, { files: false });
  await page.evaluate(async () => {
    const path = "/src/canvas/doc/canvasDocStore.ts";
    const { canvasDocStore } = await import(/* @vite-ignore */ path);
    const doc = canvasDocStore.getDoc();
    canvasDocStore.setDoc({
      ...doc,
      elements: Object.fromEntries(["system-context", "sequence", "custom/colors"].map((layer, i) => [layer, {
        id: layer, render: "custom", layer, label: layer, description: "", node_id: null,
        position: { x: 500 + i * 500, y: 350 }, size: { w: 200, h: 100 },
        group_id: null, meta: {}, created_by: "ai",
      }])),
    });
  });
  const rows = page.locator(".left-panel-row");
  await expect(rows).toHaveCount(3);
  const colors = await rows.evaluateAll((nodes) => nodes.map((row) => {
    const layer = row.getAttribute("data-testid")!.replace("left-panel-row-", "");
    const color = getComputedStyle(row.querySelector(".left-panel-swatch")!).backgroundColor;
    return { layer, color };
  }));
  const frames = page.getByTestId("canvas-diagram-frame");
  await expect(frames).toHaveCount(3);
  const borders = await frames.evaluateAll((nodes) => nodes.map((frame) => getComputedStyle(frame).borderTopColor));

  expect(borders).toEqual(colors.map((entry) => entry.color));
  await page.getByRole("button", { name: "Collapse diagrams panel" }).click();
  const collapsed = page.locator(".collapsed-left-bar__swatch");
  await expect(collapsed).toHaveCount(3);
  const swatches = await collapsed.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));

  expect(swatches).toEqual(borders);
});
