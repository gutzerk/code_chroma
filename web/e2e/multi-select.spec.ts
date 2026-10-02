import { test, expect, type Locator, type Page } from "@playwright/test";
import { clickBlockName, gotoApp } from "./helpers";

// Miro-style multi-select + group drag: shift/ctrl-click and marquee-drag build a selection across
// blocks, then dragging any selected block moves the whole selection together. Only a real browser
// exercises the modifier-click/marquee gestures and the resulting group-drag delta end to end.

// The root's own two direct children (see fixtures.ts) exercise the hierarchy strategy's own
// collision-based group drag (TopLevelChildren.tsx/useSelectionAwareDrag). A CanvasNodeBox (C1/
// Patterns/Impact/Epic) joins the same selectionStore too, via its own simpler free-move group drag
// (CanvasNodeBox.tsx's useGroupDrag) — see CanvasNodeBox.test.tsx's own "group drag" suite for that
// path's coverage; nothing here exercises it end to end.
function anchorFor(page: Page, nodeId: string): Locator {
  return page
    .getByTestId("hierarchy-top-box")
    .filter({ has: page.locator(`[data-node-id="${nodeId}"]`) });
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  return box;
}

function centre(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("shift-clicking two blocks selects both, and a plain click clears the selection", async ({
  page,
}) => {
  // Two siblings, not an ancestor and its child: clicking the ancestor to clear the selection
  // collapses it, which unmounts the very block the last assertion is about.
  await gotoApp(page);
  await clickBlockName(page, "examples");
  await clickBlockName(page, "shadow-app");
  await expect(page.getByText("backend")).toBeVisible();

  const backend = page
    .getByTestId("app-canvas")
    .locator('[data-node-id="folder::shadow-app/backend"]');
  await backend.getByText("backend", { exact: true }).click({ modifiers: ["Shift"] });

  await expect(backend).toHaveClass(/block-selected/);

  // A plain click elsewhere clears the selection (and still runs its own normal action).
  await clickBlockName(page, "frontend");
  await expect(backend).not.toHaveClass(/block-selected/);
});

test("a marquee drag over empty canvas selects every block it covers", async ({ page }) => {
  await gotoApp(page);
  await clickBlockName(page, "examples");
  const shadowApp = page.getByTestId("app-canvas").locator('[data-node-id="folder::shadow-app"]');
  await expect(shadowApp).toBeVisible();
  const box = await boxOf(shadowApp);

  await page.keyboard.down("Shift");
  await page.mouse.move(box.x - 40, box.y - 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect(shadowApp).toHaveClass(/block-selected/);

  await page.keyboard.press("Escape");
  await expect(shadowApp).not.toHaveClass(/block-selected/);
});

test("dragging one box of a multi-selection moves every selected box by the same delta", async ({
  page,
}) => {
  await gotoApp(page, { strategy: "boxes" });
  // autoexpand=off means root ("examples") starts collapsed, so its two direct children don't
  // mount until it's expanded.
  await clickBlockName(page, "examples");
  const shadowApp = anchorFor(page, "folder::shadow-app");
  const billingLite = anchorFor(page, "folder::billing-lite");
  await expect(billingLite).toBeVisible();
  await page.waitForTimeout(650); // let the activation auto-fit settle before measuring

  const shadowAppBefore = await boxOf(shadowApp);
  const billingLiteBefore = await boxOf(billingLite);

  await shadowApp.locator('[data-testid="block-header"]').click({ modifiers: ["Shift"] });
  await billingLite.locator('[data-testid="block-header"]').click({ modifiers: ["Shift"] });

  const from = centre(billingLiteBefore);
  const delta = { x: 120, y: 60 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 6 });
  await page.mouse.up();

  const shadowAppAfter = await boxOf(shadowApp);
  const billingLiteAfter = await boxOf(billingLite);

  // Both boxes moved by the same on-screen delta — the group moved as a unit, uncorrected by
  // collision avoidance (a solo drag of this size/direction would settle beside a neighbour instead,
  // per e2e/block-collision.spec.ts).
  expect(billingLiteAfter.x - billingLiteBefore.x).toBeCloseTo(delta.x, 0);
  expect(billingLiteAfter.y - billingLiteBefore.y).toBeCloseTo(delta.y, 0);
  expect(shadowAppAfter.x - shadowAppBefore.x).toBeCloseTo(delta.x, 0);
  expect(shadowAppAfter.y - shadowAppBefore.y).toBeCloseTo(delta.y, 0);
});

test("dragging the same multi-selection repeatedly keeps accumulating, never reverting", async ({
  page,
}) => {
  await gotoApp(page, { strategy: "boxes" });
  // autoexpand=off means root ("examples") starts collapsed, so its two direct children don't
  // mount until it's expanded.
  await clickBlockName(page, "examples");
  const shadowApp = anchorFor(page, "folder::shadow-app");
  const billingLite = anchorFor(page, "folder::billing-lite");
  await expect(billingLite).toBeVisible();
  await page.waitForTimeout(650);

  const start = { billingLite: await boxOf(billingLite), shadowApp: await boxOf(shadowApp) };

  for (let round = 1; round <= 4; round += 1) {
    await shadowApp.locator('[data-testid="block-header"]').click({ modifiers: ["Shift"] });
    await billingLite.locator('[data-testid="block-header"]').click({ modifiers: ["Shift"] });

    const before = { billingLite: await boxOf(billingLite), shadowApp: await boxOf(shadowApp) };
    const from = centre(before.billingLite);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Real, separately-dispatched moves with a real pause between them, so several animation
    // frames genuinely elapse mid-gesture (unlike a single `steps:N` call) — this is what used to
    // trip the StrictMode-vs-render-body-mutation bug that reset a box back to its pre-drag spot
    // the instant the previous round's drag committed.
    let x = from.x;
    let y = from.y;
    for (let i = 0; i < 6; i += 1) {
      x += 10;
      y += 10;
      await page.mouse.move(x, y);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(50);

    const after = { billingLite: await boxOf(billingLite), shadowApp: await boxOf(shadowApp) };
    expect(after.billingLite.x - before.billingLite.x).toBeGreaterThan(0);
    expect(after.billingLite.y - before.billingLite.y).toBeGreaterThan(0);
    expect(after.shadowApp.x - before.shadowApp.x).toBeGreaterThan(0);
    expect(after.shadowApp.y - before.shadowApp.y).toBeGreaterThan(0);
  }

  const end = { billingLite: await boxOf(billingLite), shadowApp: await boxOf(shadowApp) };
  // After four real drags every one of which must have moved things forward, the boxes should sit
  // far from where they started — not back at (or near) the original position.
  expect(end.billingLite.x - start.billingLite.x).toBeGreaterThan(100);
  expect(end.shadowApp.x - start.shadowApp.x).toBeGreaterThan(100);
});
