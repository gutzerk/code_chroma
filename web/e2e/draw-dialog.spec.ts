import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test("Draw… opens the dialog, and drawing a Sequence opens a 'Draw · Sequence' agent", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("tab", { name: "Diagrams" }).click();
  await page.getByTestId("draw-diagram-button").click();
  await expect(page.getByTestId("draw-dialog")).toBeVisible();
  await page.getByTestId("draw-card-sequence").click();
  await page.getByTestId("draw-dialog-prompt").fill("a file save reaches the canvas, current change only");
  await page.getByTestId("draw-dialog-prompt").press("Enter");

  await expect(page.getByTestId("draw-dialog")).toBeHidden();
  await expect(page.getByText("Draw · Sequence").first()).toBeVisible();
});

test("Escape closes the Draw dialog without launching an agent", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("tab", { name: "Diagrams" }).click();
  await page.getByTestId("draw-diagram-button").click();
  await expect(page.getByTestId("draw-dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("draw-dialog")).toBeHidden();
  await expect(page.getByTestId("agent-dock-panel-draw-sequence")).toHaveCount(0);
});
