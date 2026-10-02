import { afterEach, describe, expect, it } from "vitest";
import type { CanvasDoc, CanvasElement, DiagramsStatus, DiagramTypeSummary } from "../../state/types";
import { EMPTY_CANVAS_DOC } from "../../state/types";
import type { EngineClient } from "../../engine-client/EngineClient";
import { canvasDocStore } from "./canvasDocStore";
import { reset as resetLayerPositionCache } from "./layerPositionCache";
import {
  computeReadyDiagrams,
  deleteDiagramAndRefresh,
  isDiagramLayer,
  isRecipeBackedLayer,
  labelForDiagramLayer,
  listActiveDiagramLayers,
  removeLayerAndRefresh,
  runRecipeAndLayout,
} from "./diagramCatalog";

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
    const doc = docWith([element("c1a", "c1")]);

    expect(listActiveDiagramLayers(doc)).toEqual(["c1"]);
  });

  it("includes a custom/<id> layer present on the doc", () => {
    const doc = docWith([element("x1", "custom/my-type")]);

    expect(listActiveDiagramLayers(doc)).toEqual(["custom/my-type"]);
  });

  it("returns each distinct layer once, regardless of element count", () => {
    const doc = docWith([element("c1a", "c1"), element("c1b", "c1"), element("pat", "patterns")]);

    expect(listActiveDiagramLayers(doc).sort()).toEqual(["c1", "patterns"]);
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
    expect(isDiagramLayer("c1")).toBe(true);
    expect(isDiagramLayer("custom/my-type")).toBe(true);
    expect(isDiagramLayer("Serving Unit TLS Process (LMP-126)")).toBe(true);
  });
});

describe("labelForDiagramLayer", () => {
  const customTypes: DiagramTypeSummary[] = [
    { id: "my-type", title: "My Type", description: "", style: "" },
  ];

  it("resolves a builtin layer to its recipe label", () => {
    expect(labelForDiagramLayer("c1", [])).toBe("C1");
  });

  it("resolves a custom layer to its saved type's title", () => {
    expect(labelForDiagramLayer("custom/my-type", customTypes)).toBe("My Type");
  });

  it("falls back to the raw layer key for an unknown custom type", () => {
    expect(labelForDiagramLayer("custom/not-loaded-yet", [])).toBe("custom/not-loaded-yet");
  });

  it("labels a feature-plan/<slug> layer with its slug", () => {
    expect(labelForDiagramLayer("feature-plan/token-auth", [])).toBe("Feature plan: token-auth");
  });
});

describe("isRecipeBackedLayer", () => {
  it("is true for a builtin recipe layer", () => {
    expect(isRecipeBackedLayer("c1")).toBe(true);
  });

  it("is true for any custom/<id> layer", () => {
    expect(isRecipeBackedLayer("custom/my-type")).toBe(true);
  });

  it("is true for any feature-plan/<slug> layer", () => {
    expect(isRecipeBackedLayer("feature-plan/token-auth")).toBe(true);
  });

  it("is false for a freeform, non-recipe-backed layer", () => {
    expect(isRecipeBackedLayer("Serving Unit TLS Process (LMP-126)")).toBe(false);
  });
});

const DRAGGED_POSITION = { x: 540, y: 320 };

function docWithElement(id: string, position: { x: number; y: number }): CanvasDoc {
  return docWith([
    {
      id,
      render: "c1",
      layer: "c1",
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

    const removed = await removeLayerAndRefresh(client, "c1");
    expect(removed.ok).toBe(true);

    // Re-adding: the recipe re-projects fresh from disk with a new id, at whatever position the
    // server just wrote (the seam that used to always be overwritten by a fresh dagre layout).
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

    const added = await runRecipeAndLayout(client2, "c1");
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

    const added = await runRecipeAndLayout(client, "c1");
    expect(added.ok).toBe(true);

    // A batch is always sent here (layoutNewElements always places a lone new node), so asserting
    // on it directly -- rather than behind an `if` -- fails loudly if that assumption ever changes.
    const layoutBatch = patchCalls.at(-1) as { ops: { id: string; position: unknown }[] };
    expect(layoutBatch.ops[0]?.position).not.toEqual(DRAGGED_POSITION);
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

    const result = await deleteDiagramAndRefresh(client, "c1");

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["delete:c1", "patch"]);
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

    const result = await deleteDiagramAndRefresh(client, "c1");

    expect(result).toEqual({ ok: false, error: "disk error" });
    expect(patched).toBe(false);
  });

  it("skips the file-delete call for a layer with no on-disk artifact (e.g. epics)", async () => {
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

    const result = await deleteDiagramAndRefresh(client, "epics");

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
      ["c1", "epics", "impact", "patterns"].sort(),
    );
    expect(result.readyCustomTypes).toEqual(customTypes);
    expect(result.missingLabels).toEqual([]);
  });

  it("splits ready vs. missing off the status map, epics always ready", () => {
    const status: DiagramsStatus = {
      c1: { ready: true, fingerprint: "fp" },
      patterns: { ready: false, fingerprint: null },
    };

    const result = computeReadyDiagrams(status, [], new Set());

    expect(result.readyBuiltins.map((r) => r.name).sort()).toEqual(["c1", "epics"]);
    expect(result.missingLabels).toEqual(["Design patterns", "Change impact"]);
  });

  it("falls back to on-canvas placement for a kind status has no entry for", () => {
    const result = computeReadyDiagrams({}, [], new Set(["impact"]));

    expect(result.readyBuiltins.map((r) => r.name)).toContain("impact");
  });
});
