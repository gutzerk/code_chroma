import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// The rail is icon-only, so the hover label is the only thing naming each control on screen. It's a
// real element (not a `title` attribute), hidden until hover and never taking layout space.
// Skipped: the Diff button this test hovers was pulled from the rail (RootCanvas.tsx) while its
// logic stays in place for later; re-enable once the button comes back.
test.skip("hovering a rail icon reveals its label, and moving away hides it again", async ({ page }) => {
  await gotoApp(page);

  const diffButton = page.getByRole("button", { name: "Show diff vs last commit" });
  const tooltip = diffButton.locator(".rail-tooltip");
  await expect(tooltip).toBeHidden();

  await diffButton.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText("Show diff vs last commit");

  // The label floats over the canvas rather than widening the rail.
  const railBox = await page.getByTestId("app-rail").boundingBox();
  const tooltipBox = await tooltip.boundingBox();
  if (!railBox || !tooltipBox) throw new Error("rail or tooltip not found");
  expect(tooltipBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);

  await page.getByTestId("app-chrome").hover();
  await expect(tooltip).toBeHidden();
});

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

// The Files rail button this file used to also cover was removed with the Explorer panel. Its one
// unique claim — a disabled button swaps its tooltip for the reason — now lives at its own level,
// in RailButton.test.tsx, since no rail control is disabled on a plain first load any more.
