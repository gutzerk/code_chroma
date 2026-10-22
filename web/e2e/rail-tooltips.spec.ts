import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// The label tracks each toggle's current state, like the aria-label it mirrors.
test("a toggled rail control's label flips to describe the way back", async ({ page }) => {
  await gotoApp(page);

  const openTerminal = page.getByRole("button", { name: "Open terminal panel" });
  await openTerminal.hover();
  await expect(openTerminal.locator(".rail-tooltip")).toHaveText("Open terminal panel");

  await openTerminal.click();

  const closeTerminal = page.getByRole("button", { name: "Close terminal panel" });
  await closeTerminal.hover();
  await expect(closeTerminal.locator(".rail-tooltip")).toHaveText("Close terminal panel");
});

// Every rail control needs one, including the newest — the icon alone doesn't say "pull request".
test("the pull-request button names itself on hover", async ({ page }) => {
  await gotoApp(page);

  const prButton = page.getByRole("button", { name: "Review a GitHub pull request" });
  await prButton.hover();

  await expect(prButton.locator(".rail-tooltip")).toHaveText("Review a GitHub pull request");
});
