import { test, expect, type Page } from "@playwright/test";

// Regression: a page refresh returns the canvas to the exact same spot — persisted camera AND
// persisted tree expansion must make reload a no-op rather than drifting (the rightward drift bug:
// each reload moved x by ~-125px because the viewport's startup settle-shrink (side panels mounting
// a frame after the camera restore) was treated as a real resize and re-centered the view off the
// saved camera). We pan to a non-trivial position then reload repeatedly and assert the content
// transform never changes.
test("reload returns to the exact same panned + expanded camera (no drift)", async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
  await page.goto("/");
  // Fresh storage so this run starts clean regardless of prior runs.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="app-root"]');
  // Let first-load auto-expand (examples -> shadow-app -> backend/frontend) settle.
  await page.waitForTimeout(1500);

  const viewport = page.getByTestId("app-canvas");

  // Pan the (auto-expanded) canvas into a far-from-origin position.
  const box = await viewport.boundingBox();
  if (!box) throw new Error("viewport not found");
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 220, box.y + box.height - 170, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const baseline = await transformOf(page);

  // Several reloads: each must return to exactly the baseline (no accumulated drift).
  for (let i = 1; i <= 3; i++) {
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]');
    await page.waitForTimeout(1500);
    expect(await transformOf(page), `reload #${i} drifted the camera`).toBe(baseline);
  }
});

async function transformOf(page: Page): Promise<string> {
  return page
    .getByTestId("canvas-content")
    .evaluate((el) => getComputedStyle(el).transform);
}
