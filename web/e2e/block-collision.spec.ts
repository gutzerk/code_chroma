import { test, expect, type Locator, type Page } from "@playwright/test";
import { clickBlockName, gotoApp } from "./helpers";
import { NODE_SEP, RANK_SEP, SETTLE_MS } from "../src/canvas/collision/constants";

// Blocks stop overlapping each other: a hierarchy top-level box dragged onto its sibling follows the
// cursor honestly while the button is down, then settles into the gap the auto layout would have
// given it. Only a real browser exercises this end to end — the gap is measured off
// getBoundingClientRect at a camera scale the activation auto-fit chose, which is exactly the
// screen-pixels-to-canvas-units path unit tests have to mock.
//
// Ported off the old C1-boxes version (016-single-canvas-dashboard Stage 4 retired it: a C1 recipe
// box on the one canvas deliberately doesn't join the collision/multi-select system) onto the
// hierarchy's own `boxes` strategy — root's two direct children (see fixtures.ts:
// folder::shadow-app, folder::billing-lite), the one surface still exercising the real solver.
//
// ⚠ Every measurement here is of the `hierarchy-top-box` anchor, never of the `.block` inside it. The
// anchor is the rectangle the solver actually reasons about; the block is inset a few pixels within
// it, so comparing the two silently fails by that inset.

/** Signed clearance between two on-screen rectangles per axis; negative means they overlap on it. */
function clearance(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): { dx: number; dy: number } {
  return {
    dx: Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)),
    dy: Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)),
  };
}

function anchorFor(page: Page, nodeId: string): Locator {
  return page
    .getByTestId("hierarchy-top-box")
    .filter({ has: page.locator(`[data-node-id="${nodeId}"]`) });
}

function canvasScale(page: Page): Promise<number> {
  return page
    .getByTestId("canvas-content")
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  return box;
}

function centre(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Opens the boxes strategy and waits out the activation auto-fit, so later measurements are of a
 * settled camera rather than a transform mid-transition. */
async function openBoxes(page: Page): Promise<void> {
  await gotoApp(page, { strategy: "boxes" });
  // autoexpand=off means root ("examples") starts collapsed, so its two direct children (this
  // file's whole subject) don't mount until it's expanded.
  await clickBlockName(page, "examples");
  await expect(page.locator('[data-node-id="folder::billing-lite"]')).toBeVisible();
  await page.waitForTimeout(650);
}

/**
 * Drags the billing-lite box onto shadow-app's right edge, and returns where the gesture aimed.
 *
 * `gridLayout` packs root's two children into one row, billing-lite to shadow-app's right, exactly
 * NODE_SEP apart. Aiming at shadow-app's *centre* is ambiguous (equally close to escaping up, down,
 * or back right) and the solver is free to pick any of them; aiming at its right edge instead, same
 * y, only ever overlaps from one side, so pushing billing-lite back out to the right by NODE_SEP is
 * the only sensible landing — the same "one clear side" reasoning the old C1-chain version's own
 * side approach relied on for a landing genuinely distinguishable from "the drag was refused".
 */
async function dragBillingLiteBesideShadowApp(page: Page): Promise<void> {
  const billingLite = await boxOf(anchorFor(page, "folder::billing-lite"));
  const shadowApp = await boxOf(anchorFor(page, "folder::shadow-app"));
  const from = centre(billingLite);
  const target = { x: shadowApp.x + shadowApp.width - 10, y: centre(shadowApp).y };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
}

test("a box dropped on its neighbour settles beside it with the auto layout's gap", async ({
  page,
}) => {
  await openBoxes(page);
  const billingLite = anchorFor(page, "folder::billing-lite");
  const shadowApp = anchorFor(page, "folder::shadow-app");
  const scale = await canvasScale(page);
  const before = await boxOf(billingLite);
  const shadowAppBefore = await boxOf(shadowApp);

  await dragBillingLiteBesideShadowApp(page);
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS + 150);

  const after = await boxOf(billingLite);
  const shadowAppAfter = await boxOf(shadowApp);
  const gap = clearance(after, shadowAppAfter);
  // Clear of the neighbour, by that axis's own minimum — 1px of slack for subpixel rounding through
  // the camera transform. Unlike the old C1-chain version (which forced a horizontal approach via a
  // tight vertical rank gap), root's two children start on one grid row with no such constraint, so
  // the solver is free to resolve on whichever axis it finds a free spot first, each with its own
  // minimum (NODE_SEP horizontally, RANK_SEP vertically, per collision/constants.ts) — check the
  // axis that actually cleared, against its own minimum, not one hardcoded in advance.
  const resolvedOnX = gap.dx >= gap.dy;
  const resolvedGap = resolvedOnX ? gap.dx : gap.dy;
  const resolvedMinimum = resolvedOnX ? NODE_SEP : RANK_SEP;
  expect(resolvedGap).toBeGreaterThan(0);
  expect(resolvedGap).toBeGreaterThan(resolvedMinimum * scale - 1);
  // It came to rest snug against the neighbour rather than wherever it was released.
  expect(resolvedGap).toBeLessThan(resolvedMinimum * scale + 1);
  // Only the dragged block moved: a neighbour is a hard obstacle, never pushed aside.
  expect(Math.abs(shadowAppAfter.x - shadowAppBefore.x)).toBeLessThan(1);
  expect(Math.abs(shadowAppAfter.y - shadowAppBefore.y)).toBeLessThan(1);
  expect(Math.abs(after.x - before.x)).toBeGreaterThan(50);
});

test("the outline shown during the drag is exactly where the block ends up", async ({ page }) => {
  await openBoxes(page);
  const billingLite = anchorFor(page, "folder::billing-lite");
  const content = page.getByTestId("canvas-content");

  await dragBillingLiteBesideShadowApp(page);

  const ghost = page.getByTestId("drop-ghost");
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveAttribute("data-blocked", "false");
  const ghostBox = await boxOf(ghost);
  const transformDuringDrag = await content.evaluate((el) => getComputedStyle(el).transform);

  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS + 150);

  const after = await boxOf(billingLite);
  // The whole point of previewing: the block lands IN the outline, not merely near it.
  expect(Math.abs(after.x - ghostBox.x)).toBeLessThan(2);
  expect(Math.abs(after.y - ghostBox.y)).toBeLessThan(2);
  expect(Math.abs(after.width - ghostBox.width)).toBeLessThan(2);
  await expect(ghost).toHaveCount(0);
  // A landing doesn't change the box set, so the camera must not re-fit under the user's hands.
  expect(await content.evaluate((el) => getComputedStyle(el).transform)).toBe(transformDuringDrag);
});

// 🔴 The exemption — a code panel is a window over the map, so the solver never moves it — used to be
// proven here by dropping an inline code panel squarely onto a C1 box. That scenario no longer exists:
// a C1 box contains only architecture blocks now, and real files/classes open in the inspector panel
// instead, so the only participants left inside a diagram box are the box anchors themselves — not a
// draggable non-participant to drop onto anything.
//
// The invariant moved to CodeView.test.tsx ("never registers as a collision participant"), which
// proves it structurally rather than by geometry: a panel that never enters collisionStore cannot be
// corrected by the solver, on any canvas.

// 🔴 Also retired without a replacement: "the relationship arrow is drawn from the landing, not the
// release point". It exercised C1's own `.c1-relationship-path` SVG, drawn between C1 diagram boxes
// only — two hierarchy top-level boxes (root's own children) have no relationship/arrow between them
// at all, so there is nothing here for this invariant to be ported onto. If a future canvas feature
// draws edges between plain hierarchy boxes, this is where that coverage would be added.
