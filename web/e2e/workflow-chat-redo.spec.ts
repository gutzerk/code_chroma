import { test, expect } from "@playwright/test";
import { gotoApp, startSavedRun } from "./helpers";

// Drives the in-memory MockWorkflowEngine (no bridge): ask a step, get a redo proposal, redo, switch attempts.
test("ask a step, redo from the proposal, and view attempt 1 read-only", async ({ page }) => {
  await gotoApp(page);
  await startSavedRun(page, "Ship a feature");
  await expect(page.getByTestId("run-state")).toHaveText("Running");

  await page.getByTestId("chat-input").fill("@implement what are you doing?");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("step-rail-collapsed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show hello() on canvas" })).toBeVisible();
  await expect(page.getByTestId("run-state")).toHaveText("Running");

  await page.getByTestId("chat-input").fill("please redo implement");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("redo-card")).toBeVisible();
  await expect(page.getByTestId("run-state")).toHaveText("Stopped");
  await page.getByTestId("redo-picker").selectOption("s3");
  await expect(page.getByTestId("redo-warning")).toBeVisible();
  await page.getByTestId("redo-picker").selectOption("s2");
  await page.getByTestId("redo-note").fill("use a map");

  await page.getByTestId("redo-confirm").click();

  await expect(page.getByTestId("attempt-switcher")).toBeVisible();
  await expect(page.getByTestId("kept-plan")).toHaveText("from attempt 1");
  await page.getByTestId("attempt-1").click();
  await expect(page.getByTestId("attempt-readonly")).toBeVisible();
  await expect(page.getByRole("button", { name: /Breakpoint before/ })).toHaveCount(0);
});
