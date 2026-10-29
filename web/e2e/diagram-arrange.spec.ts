import { test, expect } from "@playwright/test";
import type { CanvasBatch, CanvasDoc } from "../src/state/types";
import { gotoApp } from "./helpers";

for (const layer of ["system-context", "patterns", "custom/layout"]) {
  test(`Arrange preserves user-moved blocks in ${layer}`, async ({ page }) => {
    await gotoApp(page, { files: false });
    await page.evaluate(async (layer) => {
      const storePath = "/src/canvas/doc/canvasDocStore.ts";
      const bridgePath = "/src/engine-client/mockBridge.ts";
      const { canvasDocStore } = await import(/* @vite-ignore */ storePath);
      const { MockBridgeEngineClient } = await import(/* @vite-ignore */ bridgePath);
      const other = layer === "system-context" ? "patterns" : "system-context";
      const elements = Object.fromEntries([
        ["a", layer, 450, 300], ["b", layer, 700, 450],
        ["c", other, 1050, 350], ["d", other, 1200, 550],
      ].map(([id, layer, x, y]) => [id, {
        id, render: layer === "patterns" ? "pattern" : layer === "system-context" ? "c1" : "custom", layer, label: id, description: "", node_id: null,
        position: { x, y }, size: { w: 100, h: 70 }, group_id: null, meta: {}, created_by: "ai",
      }]));
      const doc = { ...canvasDocStore.getDoc(), doc_id: "arrange-test", elements, edges: {} };
      const proto = MockBridgeEngineClient.prototype;
      const get = proto.getCanvas;
      const patch = proto.patchCanvas;
      const seed = (client: { canvasDoc: CanvasDoc; arrangeTestSeeded?: boolean }) => { if (!client.arrangeTestSeeded) { client.canvasDoc = structuredClone(doc); client.arrangeTestSeeded = true; } };
      proto.getCanvas = function () { seed(this); return get.call(this); };
      proto.patchCanvas = function (batch: CanvasBatch) { seed(this); return patch.call(this, batch); };
      canvasDocStore.setDoc(doc);
    }, layer);
    await page.getByRole("button", { name: "Collapse agents and workflows" }).click();
    await page.getByRole("button", { name: "Fit all open blocks", exact: true }).click();
    const box = page.locator('[data-select-id="a"]');
    const rect = (await box.boundingBox())!;
    await page.mouse.move(rect.x + 30, rect.y + 20);
    await page.mouse.down();
    await page.mouse.move(rect.x + 80, rect.y + 100, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(async () => {
      const path = "/src/canvas/doc/canvasDocStore.ts";
      return (await import(/* @vite-ignore */ path)).canvasDocStore.getDoc().elements.a.position.y;
    })).not.toBe(300);
    const positions = () => page.evaluate(async () => {
      const path = "/src/canvas/doc/canvasDocStore.ts";
      const doc: CanvasDoc = (await import(/* @vite-ignore */ path)).canvasDocStore.getDoc();
      return Object.fromEntries(Object.entries(doc.elements).map(([id, e]) => [id, e.position]));
    });
    const before = await positions();
    for (const checkbox of await page.locator(".left-panel-row").getByRole("checkbox").all()) await checkbox.check();
    await page.getByRole("button", { name: "Side by side", exact: true }).click();
    const after = await positions();

    expect(after.b.x - after.a.x).toBeCloseTo(before.b.x - before.a.x);
    expect(after.b.y - after.a.y).toBeCloseTo(before.b.y - before.a.y);
    expect(after.d.x - after.c.x).toBeCloseTo(before.d.x - before.c.x);
    expect(after.d.y - after.c.y).toBeCloseTo(before.d.y - before.c.y);
    await page.getByRole("button", { name: "Fit all open blocks", exact: true }).click();
    const arrangedRect = (await box.boundingBox())!;
    await page.mouse.move(arrangedRect.x + 30, arrangedRect.y + 20);
    await page.mouse.down();
    await page.mouse.move(arrangedRect.x + 70, arrangedRect.y + 60, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await positions()).a.y).not.toBe(after.a.y);
    const edited = await positions();
    await page.getByRole("button", { name: "Stack", exact: true }).click();
    await page.getByRole("button", { name: "Stack", exact: true }).click();
    const restored = await positions();

    expect(restored.b.x - restored.a.x).toBeCloseTo(edited.b.x - edited.a.x);
    expect(restored.b.y - restored.a.y).toBeCloseTo(edited.b.y - edited.a.y);
    expect(restored.b.x).toBeCloseTo(before.b.x);
    expect(restored.b.y).toBeCloseTo(before.b.y);
  });
}
