import { test, expect, type Page } from "@playwright/test";
import { gotoApp, openDiagramsTab } from "./helpers";

// The mock bridge starts with an empty canvas and the "Draw…" path spawns an agent, so diagrams are
// seeded by exposing the app's mock client (route-patched module) and running its recipes.
async function exposeMockClient(page: Page): Promise<void> {
  await page.route(/\/src\/engine-client\/mockBridge\.ts/, async (route) => {
    const res = await route.fetch();
    const body =
      (await res.text()) +
      `\n;{const o = MockBridgeEngineClient.prototype.getCanvas;` +
      `MockBridgeEngineClient.prototype.getCanvas = function () { window.__mock = this; return o.call(this); };}`;
    await route.fulfill({ response: res, body });
  });
}

async function seedDiagrams(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __mock?: unknown }).__mock));
  await page.evaluate(async () => {
    const modulePath = "/src/canvas/doc/diagramCatalog.ts";
    const mod = (await import(/* @vite-ignore */ modulePath)) as {
      runRecipeAndLayout: (client: never, kind: string) => Promise<unknown>;
    };
    const mock = (window as unknown as { __mock: never }).__mock;
    for (const kind of ["c1", "patterns"]) await mod.runRecipeAndLayout(mock, kind);
  });
  await expect(page.getByTestId("diagrams-tab-row-c1")).toBeVisible();
  await expect(page.getByTestId("diagrams-tab-row-patterns")).toBeVisible();
}

async function frameBoxes(page: Page) {
  const frames = page.getByTestId("canvas-diagram-frame");
  await expect(frames).toHaveCount(2);
  const out = [];
  for (let i = 0; i < 2; i++) out.push((await frames.nth(i).boundingBox())!);
  return out;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function setup(page: Page) {
  await exposeMockClient(page);
  await gotoApp(page);
  await openDiagramsTab(page);
  await seedDiagrams(page);
  await page.getByTestId("diagrams-tab-row-patterns").getByRole("checkbox").check();
  await page.getByTestId("diagrams-tab-row-c1").getByRole("checkbox").check();
}

const mode = (page: Page, name: string) =>
  page.getByRole("group", { name: "Arrange selected diagrams" }).getByRole("button", { name });

test("Side by side lays diagrams out in a row and a second click restores them", async ({ page }) => {
  await setup(page);
  const before = await frameBoxes(page);

  await mode(page, "Side by side").click();
  await expect(mode(page, "Side by side")).toHaveAttribute("aria-pressed", "true");

  await expect.poll(async () => {
    const [a, b] = await frameBoxes(page);
    return !overlaps(a, b) && Math.abs(a.y - b.y) < 40;
  }).toBe(true);

  await mode(page, "Side by side").click();
  await expect(mode(page, "Side by side")).toHaveAttribute("aria-pressed", "false");
  const rel = (bs: Awaited<ReturnType<typeof frameBoxes>>) =>
    [(bs[1].x - bs[0].x) / bs[0].width, (bs[1].y - bs[0].y) / bs[0].width];
  const want = rel(before);
  await expect.poll(async () => {
    const got = rel(await frameBoxes(page));
    return Math.abs(got[0] - want[0]) < 0.05 && Math.abs(got[1] - want[1]) < 0.05;
  }).toBe(true);
});

test("Stack and Grid arrange the diagrams", async ({ page }) => {
  await setup(page);

  await mode(page, "Stack").click();
  await expect.poll(async () => {
    const [a, b] = await frameBoxes(page);
    return Math.abs(a.x - b.x) < 40 && Math.abs(a.y - b.y) > 100;
  }).toBe(true);

  await mode(page, "Grid").click();
  await expect(mode(page, "Grid")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => {
    const [a, b] = await frameBoxes(page);
    return !overlaps(a, b);
  }).toBe(true);
});

test("hiding a diagram with the eye removes it from the canvas", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("canvas-diagram-frame")).toHaveCount(2);

  await page.getByTestId("diagrams-tab-row-patterns").getByRole("button", { name: /^Hide / }).click();

  await expect(page.getByTestId("canvas-diagram-frame")).toHaveCount(1);
  await page.getByTestId("diagrams-tab-row-patterns").getByRole("button", { name: /^Show / }).click();
  await expect(page.getByTestId("canvas-diagram-frame")).toHaveCount(2);
});

test("Ctrl+Z after arrange restores the previous positions", async ({ page }) => {
  await setup(page);
  const before = await frameBoxes(page);

  await mode(page, "Stack").click();
  await expect.poll(async () => {
    const [a, b] = await frameBoxes(page);
    return Math.abs(a.x - b.x) < 40 && Math.abs(a.y - b.y) > 100;
  }).toBe(true);

  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");

  const relPos = (bs: Awaited<ReturnType<typeof frameBoxes>>) =>
    [(bs[1].x - bs[0].x) / bs[0].width, (bs[1].y - bs[0].y) / bs[0].width];
  const want = relPos(before);
  await expect.poll(async () => {
    const got = relPos(await frameBoxes(page));
    return Math.abs(got[0] - want[0]) < 0.05 && Math.abs(got[1] - want[1]) < 0.05;
  }).toBe(true);
});
