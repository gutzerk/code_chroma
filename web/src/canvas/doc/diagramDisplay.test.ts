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
    const accent = diagramAccent("c1");

    expect(accent).toEqual({ className: "canvas-diagram-frame-c1", color: "var(--c1)" });
  });

  it("uses the same class for the frame as the accent", () => {
    const layers = ["c1", "patterns", "custom/abc", "feature-plan/x", "freeform"];

    const matches = layers.map((l) => diagramFrameColorClass(l) === diagramAccent(l).className);

    expect(matches.every(Boolean)).toBe(true);
  });

  it("hashed layers carry the hex that styles.css gives the matching frame class", () => {
    const css = readFileSync(resolve(__dirname, "../../styles.css"), "utf-8");
    const layers = ["custom/abc", "feature-plan/x", "freeform", "custom/zzz"];

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
      [el("a", "c1"), el("b", "c1"), el("g", "c1", "group"), el("n", "c1", "note"), el("x", "custom/q")].map((e) => [e.id, e]),
    ),
  };

  it("names a builtin and counts only boxes", () => {
    const display = diagramDisplayName("c1", doc);

    expect(display).toEqual({ name: "C1", typeLabel: "C1", boxCount: 2 });
  });

  it("labels other layers as Custom", () => {
    const display = diagramDisplayName("custom/q", doc);

    expect(display.typeLabel).toBe("Custom");
    expect(display.boxCount).toBe(1);
  });
});
