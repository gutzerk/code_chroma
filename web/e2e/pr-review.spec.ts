import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Reviewing a pull request end to end against the mock bridge: pick it from the open-PRs dropdown,
// it becomes the canvas's workspace, and because that workspace is read-only no diff panel there
// offers an Accept button.
// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("a picked pull request becomes the canvas's workspace and offers no Accept", async ({
  page,
}) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Review a GitHub pull request" }).click();
  await expect(page.getByTestId("pr-dialog")).toBeVisible();

  await page.getByTestId("pr-dialog-select").selectOption("7");
  await page.getByTestId("pr-dialog-open").click();

  const row = page.getByTestId("pr-dialog-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("#7");
  // Opening it also makes it active, so the row says so rather than offering to activate it.
  await expect(row).toContainText("on canvas");

  await page.getByTestId("pr-dialog-dismiss").click();
  await expect(page.getByTestId("pr-dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Show diff vs last commit" }).click();
  await expect(page.getByTestId("diff-view").first()).toBeVisible();
  await expect(page.getByTestId("diff-accept-button")).toHaveCount(0);
});

// Skipped: the Diff button this test clicks was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("closing a review removes it and returns the canvas to the main repository", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Review a GitHub pull request" }).click();
  await page.getByTestId("pr-dialog-select").selectOption("42");
  await page.getByTestId("pr-dialog-open").click();
  await expect(page.getByTestId("pr-dialog-row")).toHaveCount(1);

  await page.getByTestId("pr-dialog-close-pr").click();

  await expect(page.getByTestId("pr-dialog-row")).toHaveCount(0);
  await page.getByTestId("pr-dialog-dismiss").click();
  // Back on main, where Accept is available again.
  await page.getByRole("button", { name: "Show diff vs last commit" }).click();
  await expect(page.getByTestId("diff-accept-button").first()).toBeVisible();
});

test("the picker lists GitHub's open PRs and keeps Open disabled until one is chosen", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Review a GitHub pull request" }).click();

  const select = page.getByTestId("pr-dialog-select");
  await expect(select).toContainText("#7");
  await expect(select).toContainText("#42");
  await expect(select).toContainText("#64");
  await expect(page.getByTestId("pr-dialog-open")).toBeDisabled();
  await expect(page.getByTestId("pr-dialog-row")).toHaveCount(0);
});
