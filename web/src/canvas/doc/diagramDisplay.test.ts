import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_CANVAS_DOC, type CanvasElement } from "../../state/types";
import { diagramAccent, diagramDisplayName, DIAGRAM_HASHED_COLORS } from "./diagramDisplay";
import { diagramFrameColorClass } from "./diagramFrameColor";

function el(id: string, layer: string, render: CanvasElement["render"] = "custom"): CanvasElement {
  return {
    id, render, layer, label: id, description: "", node_id: null,
    position: { x: 0, y: 0 }, size: null, group_id: null, meta: {}, created_by: "ai",
  };
}

describe("diagramAccent", () => {
  it("keeps named token colours for the builtin recipe layers", () => {
    const accent = diagramAccent("system-context");

    expect(accent).toEqual({ className: "canvas-diagram-frame-system-context", color: "var(--c1)" });
  });

  it("uses the same class for the frame as the accent", () => {
    const layers = ["system-context", "patterns", "custom/abc", "feature-plan/x", "freeform"];

    const matches = layers.map((l) => diagramFrameColorClass(l) === diagramAccent(l).className);

    expect(matches.every(Boolean)).toBe(true);
  });

  it("hashed layers carry the hex that styles.css gives the matching frame class", () => {
    const css = readFileSync(resolve(__dirname, "../../styles.css"), "utf-8");
    const layers = ["sequence", "custom/abc", "feature-plan/x", "freeform", "custom/zzz"];

    const hexes = layers.map((layer) => {
      const { className } = diagramAccent(layer);
      return new RegExp(`\\.${className}\\s*\\{\\s*--diagram-frame-color:\\s*(#[0-9a-f]+)`).exec(css)?.[1];
    });

    expect(hexes).toEqual(layers.map((layer) => diagramAccent(layer).color));
    expect(DIAGRAM_HASHED_COLORS).toHaveLength(6);
  });
});

describe("diagramDisplayName", () => {
  const doc = {
    ...EMPTY_CANVAS_DOC,
    elements: Object.fromEntries(
      [el("a", "system-context"), el("b", "system-context"), el("g", "system-context", "group"), el("n", "system-context", "note"), el("x", "custom/q")].map((e) => [e.id, e]),
    ),
  };

  it("names a builtin and counts only boxes", () => {
    const display = diagramDisplayName("system-context", doc);

    expect(display).toEqual({ name: "System context", typeLabel: "System context", boxCount: 2, titled: false });
  });

  it("names a diagram by the title the bridge stamped on its elements", () => {
    const titled = { ...el("s", "sequence"), meta: { diagram_title: " How a file save reaches the canvas " } };
    const withTitle = { ...doc, elements: { ...doc.elements, s: titled } };

    const display = diagramDisplayName("sequence", withTitle);

    expect(display).toMatchObject({ name: "How a file save reaches the canvas", typeLabel: "Sequence", titled: true });
  });

  it("labels a saved custom type by its own title and walkthrough by its kind", () => {
    const types = [{ id: "q", title: "Data flow" }] as Parameters<typeof diagramDisplayName>[2];

    const custom = diagramDisplayName("custom/q", doc, types);
    const walkthrough = diagramDisplayName("walkthrough", doc);

    expect(custom.typeLabel).toBe("Data flow");
    expect(walkthrough.typeLabel).toBe("Walkthrough");
  });

  it("labels other layers as Custom", () => {
    const display = diagramDisplayName("custom/q", doc);

    expect(display.typeLabel).toBe("Custom");
    expect(display.boxCount).toBe(1);
  });
});

describe("diagramDisplayName with an unknown render kind", () => {
  it("counts the element as a box instead of throwing", () => {
    const doc = { ...EMPTY_CANVAS_DOC, elements: { x: el("x", "system-context", "from-a-newer-schema" as CanvasElement["render"]) } };

    const { boxCount } = diagramDisplayName("system-context", doc);

    expect(boxCount).toBe(1);
  });
});
