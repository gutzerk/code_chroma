import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Drives the in-memory MockWorkflowEngine (no bridge); a step takes ~2.5s, so stop/resume land mid-step.
test("stop the run, then resume from the stopped step", async ({ page }) => {
  await gotoApp(page);
  await page.getByTestId("workflows-toggle-button").click();
  await page.getByRole("button", { name: "Start run: Ship a feature" }).click();
  await expect(page.getByTestId("run-state")).toHaveText("Running");

  await page.getByRole("button", { name: "Stop run" }).click();

  await expect(page.getByTestId("run-state")).toHaveText("Stopped");
  await expect(page.getByTestId("step-row-plan")).toHaveAttribute("data-status", "stopped");
  await page.getByRole("button", { name: "plan, Stopped" }).click();
  await page.getByRole("button", { name: "Resume from here: plan" }).click();
  await expect(page.getByTestId("run-state")).toHaveText("Running");
});

test("pause and resume from the header, reachable by keyboard", async ({ page }) => {
  await gotoApp(page);
  await page.getByTestId("workflows-toggle-button").click();
  await page.getByRole("button", { name: "Start run: Ship a feature" }).click();
  await expect(page.getByTestId("run-state")).toHaveText("Running");

  await page.getByTestId("header-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("run-state")).toHaveText("Paused");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("run-state")).toHaveText("Running");
});
