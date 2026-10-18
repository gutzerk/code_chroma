import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

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
