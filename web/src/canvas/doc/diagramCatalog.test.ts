import { afterEach, describe, expect, it } from "vitest";
import type { CanvasDoc, CanvasElement, DiagramsStatus, DiagramTypeSummary } from "../../state/types";
import { EMPTY_CANVAS_DOC } from "../../state/types";
import type { EngineClient } from "../../engine-client/EngineClient";
import { canvasDocStore } from "./canvasDocStore";
import { reset as resetLayerPositionCache } from "./layerPositionCache";
import {
  WATCHED_DIAGRAM_EVENT_KINDS,
  computeReadyDiagrams,
  deleteDiagramAndRefresh,
  isDiagramLayer,
  isRecipeBackedLayer,
  labelForDiagramLayer,
  listActiveDiagramLayers,
  removeLayerAndRefresh,
  runRecipeAndLayout,
} from "./diagramCatalog";
import { patchCanvasDoc } from "./canvasDocStore";

function element(id: string, layer: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    render: "c1",
    layer,
    label: id,
    description: "",
    node_id: null,
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
    ...overrides,
  };
}

function docWith(elements: CanvasElement[]): CanvasDoc {
  return {
    ...EMPTY_CANVAS_DOC,
    elements: Object.fromEntries(elements.map((el) => [el.id, el])),
  };
}

describe("listActiveDiagramLayers", () => {
  it("excludes hierarchy and default, the non-diagram layers", () => {
    const doc = docWith([
      element("seed", "hierarchy", { render: "hierarchy" }),
      element("note", "default", { render: "note" }),
    ]);

    expect(listActiveDiagramLayers(doc)).toEqual([]);
  });

  it("includes a builtin recipe layer present on the doc", () => {
    const doc = docWith([element("c1a", "system-context")]);

    expect(listActiveDiagramLayers(doc)).toEqual(["system-context"]);
  });

  it("includes a custom/<id> layer present on the doc", () => {
    const doc = docWith([element("x1", "custom/my-type")]);

    expect(listActiveDiagramLayers(doc)).toEqual(["custom/my-type"]);
  });

  it("returns each distinct layer once, regardless of element count", () => {
    const doc = docWith([element("c1a", "system-context"), element("c1b", "system-context"), element("pat", "patterns")]);

    expect(listActiveDiagramLayers(doc).sort()).toEqual(["patterns", "system-context"]);
  });

  it("includes a freeform layer name that matches neither a builtin nor a custom/<id> prefix", () => {
    // A skill/agent can PATCH /repos/{id}/canvas with any layer string (routes/canvas.py) -- this
    // was the actual bug: such a diagram existed on the canvas but never showed up in the rail.
    const doc = docWith([element("x1", "Serving Unit TLS Process (LMP-126)")]);

    expect(listActiveDiagramLayers(doc)).toEqual(["Serving Unit TLS Process (LMP-126)"]);
  });
});

describe("isDiagramLayer", () => {
  it("rejects the seeded hierarchy tree and the fallback layer, the same deny-list listActiveDiagramLayers uses", () => {
    expect(isDiagramLayer("hierarchy")).toBe(false);
    expect(isDiagramLayer("default")).toBe(false);
  });

  it("accepts a builtin, a custom/<id>, and a freeform layer name", () => {
    expect(isDiagramLayer("system-context")).toBe(true);
    expect(isDiagramLayer("custom/my-type")).toBe(true);
    expect(isDiagramLayer("Serving Unit TLS Process (LMP-126)")).toBe(true);
  });
});

describe("labelForDiagramLayer", () => {
  const customTypes: DiagramTypeSummary[] = [
    { id: "my-type", title: "My Type", description: "", style: "" },
  ];

  it.each([
    ["resolves a builtin layer to its recipe label", "system-context", "System context"],
    ["resolves a custom layer to its saved type's title", "custom/my-type", "My Type"],
    ["falls back to the raw layer key for an unknown custom type", "custom/not-loaded-yet", "custom/not-loaded-yet"],
    ["labels a feature-plan/<slug> layer with its slug", "feature-plan/token-auth", "Feature plan: token-auth"],
    ["falls back to the epic id when a per-epic layer has no top-level epic box", "epics/EP-2", "EP-2"],
  ])("%s", (_name, layer, label) => {
    expect(labelForDiagramLayer(layer, customTypes)).toBe(label);
  });

  it("names the epics layer by its first top-level epic's short title when a doc is supplied", () => {
    const doc = docWith([
      element("a", "epics", { render: "epic", label: "EP-1 · Zoomable semantic map", meta: { recipe_key: "EP-1" } }),
      element("b", "epics", { render: "epic", label: "Settings: theme controls", meta: { recipe_key: "EP-3-01" } }),
    ]);
    // First top-level epic (EP-1) wins; its short title drops the "EP-1 · " prefix.
    expect(labelForDiagramLayer("epics", [], doc)).toBe("Zoomable semantic map");
  });

  it("falls back to the generic builtin label when the epics layer has no top-level epic", () => {
    const doc = docWith([element("story-only", "epics", { render: "epic", meta: { recipe_key: "EP-3-01" } })]);
    expect(labelForDiagramLayer("epics", [], doc)).toBe("Epics");
  });

  it("labels a per-epic epics/<id> layer by its short epic title", () => {
    const doc = docWith([
      element("a", "epics/EP-2", { render: "epic", label: "EP-2 · Patterns hub", meta: { recipe_key: "EP-2" } }),
    ]);
    expect(labelForDiagramLayer("epics/EP-2", [], doc)).toBe("Patterns hub");
  });
});

describe("isRecipeBackedLayer", () => {
  it.each([
    ["a builtin recipe layer", "system-context", true],
    ["any custom/<id> layer", "custom/my-type", true],
    ["any feature-plan/<slug> layer", "feature-plan/token-auth", true],
    ["any per-epic epics/<id> layer", "epics/EP-2", true],
    ["a freeform, non-recipe-backed layer", "Serving Unit TLS Process (LMP-126)", false],
  ])("is %s -> %s", (_name, layer, expected) => {
    expect(isRecipeBackedLayer(layer)).toBe(expected);
  });
});

const DRAGGED_POSITION = { x: 540, y: 320 };

function docWithElement(id: string, position: { x: number; y: number }): CanvasDoc {
  return docWith([
    {
      id,
      render: "c1",
      layer: "system-context",
      label: "System",
      description: "",
      node_id: null,
      position,
      size: null,
      group_id: null,
      meta: { recipe_key: "n1" },
      created_by: "ai",
    },
  ]);
}

afterEach(() => {
  canvasDocStore.reset();
  resetLayerPositionCache();
});

describe("remove-then-re-add position preservation", () => {
  it("restores a dragged element's position instead of re-running auto-layout", async () => {
    // The user dragged "e1" to DRAGGED_POSITION before removing the diagram.
    canvasDocStore.setDoc(docWithElement("e1", DRAGGED_POSITION));

    const patchCalls: unknown[] = [];
    const client = {
      patchCanvas: async (batch: unknown) => {
        patchCalls.push(batch);
        return { ok: true, batch_id: "b1", id_map: {}, affected: [] };
      },
      // Removal's own refetch: the layer is now empty.
      getCanvas: async () => EMPTY_CANVAS_DOC,
    } as unknown as EngineClient;

    const removed = await removeLayerAndRefresh(client, "system-context");
    expect(removed.ok).toBe(true);

    // Re-adding: the recipe re-projects fresh from disk with a new id, at whatever position the
    // server just wrote (the seam that used to always be overwritten by a fresh ELK layout).
    const client2 = {
      runRecipe: async () => ({
        ok: true as const,
        batch_id: "b2",
        id_map: { temp1: "e2" },
        affected: ["e2"],
      }),
      getCanvas: async () => docWithElement("e2", { x: 0, y: 0 }),
      patchCanvas: async (batch: unknown) => {
        patchCalls.push(batch);
        return { ok: true, batch_id: "b3", id_map: {}, affected: [] };
      },
    } as unknown as EngineClient;

    const added = await runRecipeAndLayout(client2, "system-context");
    expect(added.ok).toBe(true);

    const layoutBatch = patchCalls.at(-1) as { ops: { id: string; position: unknown }[] };
    expect(layoutBatch.ops).toEqual([{ op: "update_element", id: "e2", position: DRAGGED_POSITION }]);
  });

  it("falls back to auto-layout when no position was ever captured", async () => {
    const patchCalls: unknown[] = [];
    const client = {
      runRecipe: async () => ({
        ok: true as const,
        batch_id: "b1",
        id_map: { temp1: "e1" },
        affected: ["e1"],
      }),
      getCanvas: async () => docWithElement("e1", { x: 0, y: 0 }),
      patchCanvas: async (batch: unknown) => {
        patchCalls.push(batch);
        return { ok: true, batch_id: "b2", id_map: {}, affected: [] };
      },
    } as unknown as EngineClient;

    const added = await runRecipeAndLayout(client, "system-context");
    expect(added.ok).toBe(true);

    // A batch is always sent here (layoutNewElements always places a lone new node), so asserting
    // on it directly -- rather than behind an `if` -- fails loudly if that assumption ever changes.
    const layoutBatch = patchCalls.at(-1) as { ops: { id: string; position: unknown }[] };
    expect(layoutBatch.ops[0]?.position).not.toEqual(DRAGGED_POSITION);
  });
});

describe("runRecipeAndLayout defers the transient (0,0) snapshot", () => {
  it("applies the laid-out doc, never piling at (0,0) mid-run", async () => {
    // A fresh draw: the recipe commits its boxes at (0,0), then the layout pass repositions them.
    // The store must end up with the laid-out positions -- the transient (0,0) snapshot the recipe
    // run itself broadcasts must not surface as a pile.
    const patchCalls: unknown[] = [];
    let canvasCalls = 0;
    const client = {
      runRecipe: async () => ({
        ok: true as const,
        batch_id: "b1",
        id_map: { temp1: "e1", temp2: "e2" },
        affected: ["e1", "e2"],
      }),
      patchCanvas: async (batch: unknown) => {
        patchCalls.push(batch);
        return { ok: true, batch_id: "b2", id_map: {}, affected: [] };
      },
      // First fetch sees the boxes at (0,0) (the recipe's just-committed state); the post-layout
      // fetch returns them laid out.
      getCanvas: async () => {
        canvasCalls += 1;
        const atOrigin = canvasCalls === 1;
        return docWith([
          element("e1", "system-context", {
            render: "c1",
            position: atOrigin ? { x: 0, y: 0 } : { x: 100, y: 120 },
            meta: { recipe_key: "n1" },
          }),
          element("e2", "system-context", {
            render: "c1",
            position: atOrigin ? { x: 0, y: 0 } : { x: 460, y: 120 },
            meta: { recipe_key: "n2" },
          }),
        ]);
      },
    } as unknown as EngineClient;

    const added = await runRecipeAndLayout(client, "system-context");

    expect(added.ok).toBe(true);
    // The layout pass sent one batch of update_element position ops.
    expect(patchCalls.length).toBe(1);
    expect((patchCalls[0] as { ops: unknown[] }).ops.length).toBe(2);
    // The store finally holds the laid-out doc, not the origin pile. These are the mock's
    // post-layout values (its second getCanvas()), not a layout algorithm's output -- this test
    // pins the defer/release flow, not the (separately-covered) layout calculation.
    expect(canvasDocStore.getDoc().elements.e1.position).toEqual({ x: 100, y: 120 });
    expect(canvasDocStore.getDoc().elements.e2.position).toEqual({ x: 460, y: 120 });
  });

  it("withholds an out-of-band refetch that still shows a deferred layer piled at (0,0)", async () => {
    // The live-ping path: a "changed" socket ping refetches the canvas while a layer is still
    // mid-layout, and the server's floor snapshot still has every box at (0,0). The content guard in
    // fetchAndApplyCanvasDoc must drop that snapshot -- the prior doc (what the user last saw) stays.
    const prior = docWith([element("e0", "system-context", { position: { x: 30, y: 40 } })]);
    canvasDocStore.setDoc(prior);
    const client = {
      patchCanvas: async () => ({ ok: true as const, batch_id: "b2", id_map: {}, affected: [] }),
      // The post-write refetch swaps in the origin-piled recipe commit -- only a real (non-deferred)
      // fetch should surface it; while "system-context" is deferred the guard keeps the prior doc.
      getCanvas: async () =>
        docWith([element("e1", "system-context", { position: { x: 0, y: 0 }, meta: { recipe_key: "n1" } })]),
    } as unknown as EngineClient;

    // Simulate the recipe run having put the layer mid-layout, then an unrelated write's refetch.
    canvasDocStore.deferLayout("system-context");
    await patchCanvasDoc(client, [{ op: "update_element", id: "e0", position: { x: 30, y: 40 } }]);
    canvasDocStore.releaseLayout("system-context");

    // The origin-piled snapshot never flashed; the user's prior view is untouched.
    expect(canvasDocStore.getDoc().elements.e0.position).toEqual({ x: 30, y: 40 });
    expect(canvasDocStore.getDoc().elements.e1).toBeUndefined();
  });
});

describe("deleteDiagramAndRefresh", () => {
  it("deletes the file first, then removes the layer from the canvas", async () => {
    canvasDocStore.setDoc(docWithElement("e1", DRAGGED_POSITION));
    const calls: string[] = [];
    const client = {
      deleteDiagram: async (kind: string) => {
        calls.push(`delete:${kind}`);
        return { deleted: true };
      },
      patchCanvas: async () => {
        calls.push("patch");
        return { ok: true, batch_id: "b1", id_map: {}, affected: [] };
      },
      getCanvas: async () => EMPTY_CANVAS_DOC,
    } as unknown as EngineClient;

    const result = await deleteDiagramAndRefresh(client, "system-context");

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["delete:system-context", "patch"]);
  });

  it("leaves the canvas untouched when the file delete fails", async () => {
    canvasDocStore.setDoc(docWithElement("e1", DRAGGED_POSITION));
    let patched = false;
    const client = {
      deleteDiagram: async () => {
        throw new Error("disk error");
      },
      patchCanvas: async () => {
        patched = true;
        return { ok: true, batch_id: "b1", id_map: {}, affected: [] };
      },
      getCanvas: async () => EMPTY_CANVAS_DOC,
    } as unknown as EngineClient;

    const result = await deleteDiagramAndRefresh(client, "system-context");

    expect(result).toEqual({ ok: false, error: "disk error" });
    expect(patched).toBe(false);
  });

  it("skips the file-delete call for a freeform layer with no backing recipe", async () => {
    // A diagram a skill/agent PATCHed straight onto the canvas under a freeform layer name has no
    // on-disk artifact for an `engineClient.deleteDiagram` call to remove (it isn't a recipe).
    canvasDocStore.setDoc(EMPTY_CANVAS_DOC);
    const calls: string[] = [];
    const client = {
      deleteDiagram: async () => {
        calls.push("delete");
        return { deleted: true };
      },
      patchCanvas: async () => ({ ok: true, batch_id: "b1", id_map: {}, affected: [] }),
      getCanvas: async () => EMPTY_CANVAS_DOC,
    } as unknown as EngineClient;

    const result = await deleteDiagramAndRefresh(client, "auth-lens");

    expect(result.ok).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("computeReadyDiagrams", () => {
  it("treats a null status as ready (fails open) for every builtin and custom type", () => {
    const customTypes: DiagramTypeSummary[] = [
      { id: "my-type", title: "My Type", description: "", style: "" },
    ];

    const result = computeReadyDiagrams(null, customTypes, new Set());

    expect(result.readyBuiltins.map((r) => r.name).sort()).toEqual(
      ["system-context", "epics", "impact", "patterns", "sequence", "walkthrough"].sort(),
    );
    expect(result.readyCustomTypes).toEqual(customTypes);
    expect(result.missingLabels).toEqual([]);
  });

  it("lists epics among the watched diagram event channels so a written epics.json auto-places", () => {
    expect(WATCHED_DIAGRAM_EVENT_KINDS).toContain("epics");
  });

  it("splits ready vs. missing off the status map, epics generated like the rest", () => {
    const status: DiagramsStatus = {
      "system-context": { ready: true, fingerprint: "fp" },
      patterns: { ready: false, fingerprint: null },
    };

    const result = computeReadyDiagrams(status, [], new Set());

    expect(result.readyBuiltins.map((r) => r.name).sort()).toEqual(["system-context"]);
    expect(result.missingLabels.sort()).toEqual([
      "Change impact", "Design patterns", "Epics", "Sequence", "Walkthrough",
    ]);
  });

  it("falls back to on-canvas placement for a kind status has no entry for", () => {
    const result = computeReadyDiagrams({}, [], new Set(["impact"]));

    expect(result.readyBuiltins.map((r) => r.name)).toContain("impact");
  });

  it("always lists every type in allLabels, even when all are already drawn", () => {
    const status: DiagramsStatus = {
      "system-context": { ready: true, fingerprint: "fp" },
      epics: { ready: true, fingerprint: "fp" },
      patterns: { ready: true, fingerprint: "fp" },
      impact: { ready: true, fingerprint: "fp" },
      sequence: { ready: true, fingerprint: "fp" },
      walkthrough: { ready: true, fingerprint: "fp" },
      "custom/my-type": { ready: true, fingerprint: "fp" },
    };
    const customTypes: DiagramTypeSummary[] = [
      { id: "my-type", title: "My Type", description: "", style: "" },
    ];

    const result = computeReadyDiagrams(status, customTypes, new Set());

    // None are "missing", yet the draw prompt must still offer every type -- "Draw…" is a full
    // menu regardless of what's already on the canvas.
    expect(result.missingLabels).toEqual([]);
    expect(result.allLabels.sort()).toEqual(
      ["Change impact", "Design patterns", "Epics", "My Type", "Sequence", "System context", "Walkthrough"].sort(),
    );
  });
});

describe("decisions/<question_id> layers", () => {
  it("counts as a diagram layer while the plain decisions layer stays hidden", () => {
    expect(isDiagramLayer("decisions/q1")).toBe(true);
    expect(isDiagramLayer("decisions")).toBe(false);
  });

  it("is not recipe-backed so it is never refreshed through a recipe", () => {
    expect(isRecipeBackedLayer("decisions/q1")).toBe(false);
  });

  it("is labelled from the question text, shortened", () => {
    const question = element("q1", "questions", { render: "question", label: "How should checkout be structured across the whole platform today?" });
    const doc: CanvasDoc = { ...EMPTY_CANVAS_DOC, elements: { q1: question } };

    const label = labelForDiagramLayer("decisions/q1", [], doc);

    expect(label.length).toBeLessThanOrEqual(48);
    expect(label.startsWith("How should checkout")).toBe(true);
  });

  it("falls back to the question id when the question is unknown", () => {
    expect(labelForDiagramLayer("decisions/q9", [])).toBe("q9");
  });

  it("deletes canvas content only, without a file delete call", async () => {
    const calls: string[] = [];
    const client = { deleteDiagram: async (l: string) => { calls.push(l); return { deleted: true }; } } as unknown as EngineClient;

    await deleteDiagramAndRefresh(client, "decisions/q1");

    expect(calls).toEqual([]);
  });
});
