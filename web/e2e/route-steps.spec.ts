import { test, expect, type Page } from "@playwright/test";
import { clickTreeNodeName, gotoApp } from "./helpers";

const step = (id: string, order: number, title: string, kind: string, node_ids: string[], children: object[] = []) =>
  ({ id, order, title, kind, node_ids, children });

// The wiki-general "Update the architecture map" route, as the bridge stamps it (recipes.py _with_route).
const STEPS = [
  step("detect", 1, "Detect stale pages", "trigger", ["folder::billing-lite"]),
  step("patch", 2, "Patch affected pages", "ai", ["folder::billing-lite"], [
    { id: "c1", label: "refresh_page", node_id: "folder::billing-lite", line: 12 },
    { id: "c2", label: "no_target", line: 40 },
  ]),
  step("check", 3, "Check the map", "check", ["folder::billing-lite"]),
];
const ROUTE = {
  id: "update-map", title: "Update the architecture map", steps: STEPS,
  summary: "3 steps · 1 files · 1 AI steps",
};

async function seedRouteDiagram(page: Page): Promise<void> {
  await page.evaluate(async ({ steps, route }) => {
    const path = "/src/canvas/doc/canvasDocStore.ts";
    const { canvasDocStore } = await import(/* @vite-ignore */ path);
    const doc = canvasDocStore.getDoc();
    const elements = Object.fromEntries(steps.map((s: { id: string; order: number; title: string }, i: number) => [s.id, {
      id: s.id, render: "custom", layer: "custom/update-map", label: s.title, description: "", node_id: null,
      position: { x: 500 + i * 260, y: 350 }, size: { w: 220, h: 110 },
      group_id: null, meta: { route, route_step: s }, created_by: "ai",
    }]));
    canvasDocStore.setDoc({ ...doc, doc_id: "route-test", elements, edges: {} });
  }, { steps: STEPS, route: ROUTE });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error" && !msg.text().includes("no bridge")) errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("expanding a route step lists its calls and opens a child", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, { files: false });
  await seedRouteDiagram(page);
  const chip = page.getByTestId("route-step-chip");
  await expect(chip).toHaveCount(1);

  await chip.click();

  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("route-step-children")).toContainText("refresh_page");
  await page.getByTestId("route-step-child-open").click();
  await expect(page.getByTestId("route-step-children")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Show route lights the route, dims the rest and walks the steps", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page);
  await clickTreeNodeName(page, "examples");
  await seedRouteDiagram(page);
  await page.getByRole("button", { name: "Collapse agents and workflows" }).click();

  await page.getByTestId("show-route").click();

  await expect(page.getByTestId("route-card")).toBeVisible();
  await expect(page.getByTestId("route-card-step")).toHaveCount(3);
  await expect(page.locator("[data-route-lit]").first()).toBeAttached();
  await expect(page.locator("[data-route-dim]").first()).toBeAttached();
  await page.getByTestId("route-walk").click();
  const active = page.locator(".route-card-step--active");
  await expect(active).toContainText("Detect stale pages");
  await expect(active).toContainText("Patch affected pages", { timeout: 5000 });
  expect(errors).toEqual([]);
});
