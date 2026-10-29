import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// measureBoxSize.ts and sequenceBoard.ts copy pixel metrics from styles.css; jsdom has no layout, so only a real browser catches drift.
const TOLERANCE_PX = 2;

const LONG_NAME = "Billing reconciliation orchestrator for every regional ledger and payout batch";
const DESCRIPTION = "Matches ledger rows to payouts.";

// One role box per anatomy variant; each adds one row on top of the plain entry box (order and plan_kind both open the top band).
const ROLE_VARIANTS: Record<string, { label?: string; description?: string; node_id?: string; meta?: Record<string, unknown> }> = {
  "name-only": {},
  "long-name": { label: LONG_NAME },
  description: { description: DESCRIPTION },
  path: { description: DESCRIPTION, meta: { path: "src/billing/ledger.py" } },
  "node-id": { description: DESCRIPTION, node_id: "folder::shadow-app/backend/domain" },
  order: { description: DESCRIPTION, meta: { order: "1" } },
  plan: { description: DESCRIPTION, meta: { plan_kind: "add" } },
};

/** Replaces the canvas doc with `elements` (plain JSON built here), through the page's own store. */
async function seedCanvas(page: Page, docId: string, elements: { id: string }[]): Promise<void> {
  await page.evaluate(async ({ docId, elements }) => {
    const path = "/src/canvas/doc/canvasDocStore.ts";
    const { canvasDocStore } = await import(/* @vite-ignore */ path);
    canvasDocStore.setDoc({ ...canvasDocStore.getDoc(), doc_id: docId, edges: {}, elements: Object.fromEntries(elements.map((e) => [e.id, e])) });
  }, { docId, elements });
}

const BASE = { description: "", node_id: null, size: null, group_id: null, created_by: "ai" };

const roleBoxes = () =>
  Object.entries(ROLE_VARIANTS).map(([id, v], i) => ({
    ...BASE, id, render: "custom", layer: "custom/size-guard", label: v.label ?? "Ledger API", description: v.description ?? "",
    node_id: v.node_id ?? null, position: { x: 400 + (i % 3) * 420, y: 300 + Math.floor(i / 3) * 400 }, meta: { kind: "api", ...v.meta },
  }));

const seq = (id: string, label: string, meta: object) => ({ ...BASE, id, label, render: "sequence", layer: "sequence", position: { x: 400, y: 300 }, meta });
const SEQUENCE = [
  seq("client", "Client", { role: "participant", recipe_key: "client", phases: [{ id: "p1", name: "Prepare", kind: "prepare", from_order: 1, to_order: 3 }] }),
  seq("api", "API", { role: "participant", recipe_key: "api" }),
  seq("m1", "POST /go", { role: "message", from: "client", to: "api", order: "1" }),
  seq("m2", "Validate the payload", { role: "message", from: "api", to: "api", order: "2" }),
  seq("m3", "200 OK", { role: "message", from: "api", to: "client", order: "3", return: true }),
];

/** Fails fast when the Google web fonts (index.html) a test draws with did not load: fallback fonts change every text width. */
async function expectWebFonts(page: Page, families: string[]): Promise<void> {
  const missing = await page.evaluate(async (families) => {
    await document.fonts.ready;
    const loaded = new Set([...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replace(/"/g, "")));
    return families.filter((family) => !loaded.has(family));
  }, families);
  expect(missing, "web fonts not loaded (offline?); widths would be measured with fallback fonts").toEqual([]);
}

/** The viewport's current scale, read off the transformed layer, so rendered sizes compare at 100%. */
async function canvasScale(page: Page): Promise<number> {
  return page.locator("[data-zoom]").first().evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).a || 1);
}

test("role boxes render at the height layoutBoxSize reserves for them", async ({ page }) => {
  await gotoApp(page, { files: false });
  await seedCanvas(page, "size-guard", roleBoxes());
  await expect(page.locator('[data-select-id="node-id"] [data-testid="canvas-node-members"]')).toBeVisible();
  await expect(page.locator("[data-zoom]").first()).toHaveAttribute("data-zoom", "full");
  await expectWebFonts(page, ["DM Sans", "JetBrains Mono"]);
  const scale = await canvasScale(page);

  const rows = await page.evaluate(async (ids) => {
    const path = "/src/canvas/doc/measureBoxSize.ts";
    const { layoutBoxSize } = await import(/* @vite-ignore */ path);
    const storePath = "/src/canvas/doc/canvasDocStore.ts";
    const { canvasDocStore } = await import(/* @vite-ignore */ storePath);
    await document.fonts.ready;
    const doc = canvasDocStore.getDoc();
    return ids.map((id) => {
      const box = document.querySelector(`[data-testid="canvas-node-box"][data-select-id="${id}"]`);
      const rect = box?.getBoundingClientRect();
      const computed = layoutBoxSize(doc.elements[id]);
      return { id, renderedH: rect?.height ?? -1, renderedW: rect?.width ?? -1, layoutH: computed?.h ?? -1, layoutW: computed?.w ?? -1 };
    });
  }, Object.keys(ROLE_VARIANTS));

  for (const row of rows) {
    expect.soft(Math.abs(row.renderedH / scale - row.layoutH), `${row.id} height`).toBeLessThanOrEqual(TOLERANCE_PX);
    expect.soft(Math.abs(row.renderedW / scale - row.layoutW), `${row.id} width`).toBeLessThanOrEqual(TOLERANCE_PX);
  }
  expect(rows).toHaveLength(Object.keys(ROLE_VARIANTS).length);
});

test("a sequence board's copied CSS metrics match what the browser draws", async ({ page }) => {
  await gotoApp(page, { files: false });
  await seedCanvas(page, "size-guard-seq", SEQUENCE);
  await expect(page.getByTestId("sequence-lane")).toHaveCount(2);
  await page.getByRole("button", { name: "Expand Validate the payload" }).click();
  await expect(page.locator(".seq-step--expanded")).toHaveCount(1);
  await expectWebFonts(page, ["DM Sans", "Inter", "JetBrains Mono"]);
  const scale = await canvasScale(page);

  const measured = await page.evaluate(async () => {
    const path = "/src/canvas/doc/sequenceBoard.ts";
    const { SEQUENCE_BOARD } = await import(/* @vite-ignore */ path);
    await document.fonts.ready;
    const box = (node: Element | null) => {
      const el = node as HTMLElement | null;
      return { x: el?.offsetLeft ?? -1, y: el?.offsetTop ?? -1, w: el?.offsetWidth ?? -1, h: el?.offsetHeight ?? -1 };
    };
    // Content taller or wider than its fixed box means a copied padding/line metric drifted.
    const overflow = (node: Element) => Math.max(node.scrollHeight - node.clientHeight, node.scrollWidth - node.clientWidth);
    const steps = [...document.querySelectorAll(".seq-step")].map((node) => ({
      id: node.getAttribute("data-step-id"),
      expanded: node.classList.contains("seq-step--expanded"),
      w: node.getBoundingClientRect().width,
      h: node.getBoundingClientRect().height,
      overflow: overflow(node),
    }));
    // The expanded lane is the one whose rows hold the open step's top edge.
    const open = document.querySelector(".seq-step--expanded")?.getBoundingClientRect();
    const holdsOpenStep = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return open !== undefined && open.top >= rect.top - 1 && open.top < rect.bottom;
    };
    const lanes = [...document.querySelectorAll('[data-testid="sequence-lane"]')].map((node) => ({
      expanded: holdsOpenStep(node),
      lane: box(node),
      label: box(node.querySelector(".seq-lane-label")),
    }));
    // The legend's one-line width, from an unwrapped copy so the board itself is untouched.
    const legend = document.querySelector('[data-testid="sequence-legend"]') as HTMLElement;
    const probe = legend.cloneNode(true) as HTMLElement;
    Object.assign(probe.style, { right: "auto", flexWrap: "nowrap", visibility: "hidden" });
    legend.parentElement?.appendChild(probe);
    const legendNaturalW = probe.offsetWidth;
    probe.remove();
    return {
      board: SEQUENCE_BOARD,
      legendNaturalW,
      steps,
      lanes,
      pills: [...document.querySelectorAll('[data-testid="sequence-phase-pill"]')].map(box),
      legend: box(document.querySelector('[data-testid="sequence-legend"]')),
      diagram: box(document.querySelector('[data-testid="sequence-diagram"]')),
    };
  });

  const { board } = measured;
  const near = (actual: number, expected: number, what: string) =>
    expect.soft(Math.abs(actual - expected), `${what}: drew ${actual}, TS says ${expected}`).toBeLessThanOrEqual(TOLERANCE_PX);
  for (const step of measured.steps) {
    const want = step.expanded ? { w: board.expandedW, h: board.expandedH } : { w: board.boxW, h: board.boxH };
    near(step.w / scale, want.w, `step ${step.id} width`);
    near(step.h / scale, want.h, `step ${step.id} height`);
    expect.soft(step.overflow, `step ${step.id} content overflow`).toBeLessThanOrEqual(TOLERANCE_PX);
  }
  for (const { expanded, lane, label } of measured.lanes) {
    if (!expanded) near(lane.h, board.laneH, "lane height");
    else expect.soft(lane.h, "expanded lane holds its open step").toBeGreaterThanOrEqual(board.expandedTop + board.expandedH);
    near(label.x, board.labelX, "lane label left");
    near(label.w, board.labelW, "lane label width");
    expect.soft(label.y + label.h, "lane label fits its lane").toBeLessThanOrEqual(lane.h);
  }
  expect.soft(measured.lanes.filter((lane) => lane.expanded), "exactly one lane holds the open step").toHaveLength(1);
  for (const pill of measured.pills) {
    near(pill.y, board.pillY, "phase pill top");
    near(pill.h, board.pillH, "phase pill height");
  }
  near(measured.legendNaturalW, board.legendNaturalW, "legend one-line width");
  // The board reserves legendLines * legendLineH below the lanes; a wider or taller legend spills out of the frame.
  expect.soft(measured.legend.y + measured.legend.h, "legend fits the board").toBeLessThanOrEqual(measured.diagram.h + TOLERANCE_PX);
  expect(measured.steps.some((step) => step.expanded)).toBe(true);
  expect(measured.pills.length).toBeGreaterThan(0);
});
