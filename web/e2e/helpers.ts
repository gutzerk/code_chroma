import type { Locator, Page } from "@playwright/test";

/** Clicks a hierarchy label in the Project Tree, not similarly named diagram content. */
export async function clickTreeNodeName(page: Page, name: string): Promise<void> {
  await page.getByTestId("left-panel-files").getByText(name, { exact: true }).click();
}

export function treeNode(page: Page, nodeId: string): Locator {
  return page
    .getByTestId("left-panel-files")
    .locator(`[data-testid="tree-node"][data-node-id="${nodeId}"]`);
}

// Disables first-load auto-expand so interaction specs begin with a known-collapsed Project Tree;
// opens the left panel's Files tab (the tree's home) unless `files: false`.
export async function gotoApp(page: Page, opts: { files?: boolean } = {}): Promise<void> {
  await page.goto("/?autoexpand=off");
  await page.waitForSelector('[data-testid="app-root"]');
  if (opts.files ?? true) await page.getByRole("tab", { name: "Files", exact: true }).click();
}

/** A minimal 100x70 canvas-doc box on `layer` at (x, y), for seeding specs with `seedCanvasDoc`. */
export function diagramBox(id: string, layer: string, x = 400, y = 300) {
  const render = layer === "patterns" ? "pattern" : layer === "system-context" ? "c1" : "custom";
  return {
    id, render, layer, label: id, description: "", node_id: null,
    position: { x, y }, size: { w: 100, h: 70 }, group_id: null, meta: {}, created_by: "ai",
  };
}

/** Replaces the canvas doc with `seed` in the page's store and in the mock bridge, so a re-read (a window focus, a canvas ping) keeps it. */
export async function seedCanvasDoc(
  page: Page,
  seed: { doc_id?: string; elements: Record<string, unknown>; edges?: Record<string, unknown> },
): Promise<void> {
  await page.evaluate(async (seed) => {
    const storePath = "/src/canvas/doc/canvasDocStore.ts";
    const bridgePath = "/src/engine-client/mockBridge.ts";
    const { canvasDocStore } = await import(/* @vite-ignore */ storePath);
    const { MockBridgeEngineClient } = await import(/* @vite-ignore */ bridgePath);
    const doc = { ...canvasDocStore.getDoc(), edges: {}, ...seed };
    const proto = MockBridgeEngineClient.prototype;
    const get = proto.getCanvas;
    const patch = proto.patchCanvas;
    const seeded = new WeakSet<object>();
    const apply = (client: { canvasDoc: unknown }) => {
      if (seeded.has(client)) return;
      client.canvasDoc = structuredClone(doc);
      seeded.add(client);
    };
    proto.getCanvas = function (...args: unknown[]) { apply(this); return get.apply(this, args); };
    proto.patchCanvas = function (...args: unknown[]) { apply(this); return patch.apply(this, args); };
    canvasDocStore.setDoc(doc);
  }, seed);
}

// Starts a run of a saved workflow: saved workflows live on the All workflows screen (header list button).
export async function startSavedRun(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name: /Workflows/ }).click();
  await page.getByRole("button", { name: "All workflows", exact: true }).click();
  await page.getByRole("button", { name: `Run ${name}`, exact: true }).click();
}
