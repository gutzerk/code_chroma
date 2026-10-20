import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

async function runAgent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Run agent" }).click();
}

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

test("agents full screen shows one window, tabs switch it, and the left bar still works", async ({
  page,
}) => {
  await gotoApp(page, { files: false });
  await runAgent(page);
  await runAgent(page);
  await page.getByRole("button", { name: "Expand agents to full screen" }).click();

  await expect(page.getByTestId("agent-full-screen")).toBeVisible();
  await expect(page.getByTestId("collapsed-left-bar")).toBeVisible();
  await expect(page.locator(".agent-full-window")).toHaveCount(1);

  const firstWindow = await page.locator(".agent-full-window").getAttribute("aria-label");
  await page.getByRole("tab", { name: /agent2/ }).click();
  await expect(page.locator(".agent-full-window")).toHaveCount(1);
  expect(await page.locator(".agent-full-window").getAttribute("aria-label")).not.toBe(firstWindow);

  await page.getByRole("button", { name: "Open Files" }).click();
  await expect(page.getByTestId("left-panel")).toBeVisible();
  await expect(page.getByTestId("agent-full-screen")).toHaveCount(0);
});

test("collapsed agents show a1 and a2 in a row at the top right", async ({ page }) => {
  await gotoApp(page, { files: false });
  await runAgent(page);
  await runAgent(page);
  await page.getByRole("button", { name: "Collapse agents panel" }).click();

  const bar = page.getByTestId("agents-collapsed-bar");
  await expect(bar).toBeVisible();
  const buttons = bar.locator(".agents-collapsed-bar-button");
  await expect(buttons).toHaveText(["a1", "a2"]);

  const [first, second, barBox, viewport] = await Promise.all([
    buttons.nth(0).boundingBox(),
    buttons.nth(1).boundingBox(),
    bar.boundingBox(),
    page.viewportSize(),
  ]);
  expect(first!.y).toBeCloseTo(second!.y, 0);
  expect(second!.x).toBeGreaterThan(first!.x);
  expect(barBox!.x + barBox!.width).toBeGreaterThan(viewport!.width - 40);
});
