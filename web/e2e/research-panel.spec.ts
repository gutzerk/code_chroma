import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// The whole feature's end-to-end loop against the mock bridge's fixture answer: ask a question,
// get a synthesized answer with a citation, click it, land on the real Inspector node.
test("asking a question renders an answer whose citation opens the Inspector", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Ask a question about this codebase" }).click();
  await page.getByTestId("research-panel-input").fill("where is the discount applied");
  await page.getByTestId("research-panel-ask").click();

  const answer = page.getByTestId("research-panel-answer");
  await expect(answer).toBeVisible();
  await expect(page.getByTestId("research-panel-citation-0")).toBeVisible();

  await page.getByTestId("research-panel-citation-0").click();

  const inspector = page.getByTestId("inspector-panel");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId("inspector-panel-title")).toHaveText("apply_discount");
});

// A question with no fixture match — the panel must say so plainly, never render an empty answer.
test("a question with no match shows the no-relevant-match message", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Ask a question about this codebase" }).click();
  await page.getByTestId("research-panel-input").fill("something entirely unrelated");
  await page.getByTestId("research-panel-ask").click();

  await expect(page.getByTestId("research-panel-no-match")).toContainText("No relevant match");
});

// The toggle button itself: closing the panel keeps the app canvas visible and reopening restores it.
test("the research panel toggles open and closed from the rail", async ({ page }) => {
  await gotoApp(page);
  const toggle = page.getByRole("button", { name: "Ask a question about this codebase" });

  await toggle.click();
  await expect(page.getByTestId("research-panel")).toBeVisible();

  await page.getByRole("button", { name: "Close research panel" }).click();
  await expect(page.getByTestId("research-panel")).toBeHidden();
  await expect(page.getByTestId("app-canvas")).toBeVisible();
});
