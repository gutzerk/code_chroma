import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test("the collapsed left bar reopens the panel on the right tab (expand, folder, top-bar toggle)", async ({
  page,
}) => {
  await gotoApp(page, { files: false });
  const panel = page.getByTestId("left-panel");
  await expect(panel).toBeVisible();

  await page.getByRole("button", { name: "Collapse diagrams panel" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Expand diagrams panel" }).click();
  await expect(page.getByRole("tab", { name: "Diagrams" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Collapse diagrams panel" }).click();
  await page.getByRole("button", { name: "Open Files" }).click();
  await expect(page.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Collapse diagrams panel" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: /Show diagrams panel/ }).click();
  await expect(panel).toBeVisible();
});

test("a collapsed-bar color box hides its diagram (dashed) and restores it", async ({ page }) => {
  await gotoApp(page, { files: false });
  // The mock bridge starts with no diagram; seed one through the app's own canvas-doc store module.
  await page.evaluate(async () => {
    const modulePath = "/src/canvas/doc/canvasDocStore.ts";
    const { canvasDocStore } = await import(/* @vite-ignore */ modulePath);
    const doc = canvasDocStore.getDoc();
    canvasDocStore.setDoc({
      ...doc,
      elements: {
        c1a: {
          id: "c1a", render: "c1", layer: "c1", label: "System", description: "", node_id: null,
          position: { x: 0, y: 0 }, size: null, group_id: null, meta: {}, created_by: "ai",
        },
      },
    });
  });
  await page.getByRole("button", { name: "Collapse diagrams panel" }).click();

  const box = page.locator(".collapsed-left-bar__diagram").first();
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("aria-pressed", "true");

  await box.click();
  await expect(box).toHaveAttribute("aria-pressed", "false");
  await expect(box.locator(".collapsed-left-bar__swatch--hidden")).toHaveCount(1);

  await box.click();
  await expect(box).toHaveAttribute("aria-pressed", "true");
  await expect(box.locator(".collapsed-left-bar__swatch--hidden")).toHaveCount(0);
});

test("the floating activity panel collapses and reopens even without agents", async ({ page }) => {
  await gotoApp(page, { files: false });
  const panel = page.getByTestId("activity-panel");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Collapse agents and workflows" }).click();
  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(page.getByTestId("activity-reopen")).toBeVisible();
  await page.getByRole("button", { name: "Expand agents and workflows" }).click();
  await expect(page.getByRole("button", { name: "Run agent" })).toBeVisible();
});

test("full screen reaches the diagrams panel edge, or the screen edge once it is collapsed", async ({
  page,
}) => {
  await gotoApp(page, { files: false });
  const panel = page.getByTestId("activity-panel");
  const left = page.getByTestId("left-panel");
  await page.getByRole("button", { name: "Full screen" }).click();
  await expect(panel).toHaveClass(/is-full/);
  const leftRight = (await left.boundingBox())!.x + (await left.boundingBox())!.width;
  expect((await panel.boundingBox())!.x).toBeGreaterThanOrEqual(leftRight);

  await page.getByRole("button", { name: "Collapse diagrams panel" }).click();
  await expect(panel).toHaveClass(/is-full/);
  expect((await panel.boundingBox())!.x).toBeLessThan(leftRight);
});
