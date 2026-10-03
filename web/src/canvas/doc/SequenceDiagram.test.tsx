import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SequenceDiagram } from "./SequenceDiagram";
import { descriptionPopupStore } from "./descriptionPopupStore";
import type { CanvasElement } from "../../state/types";
import { stringMeta } from "./elementMeta";

// Mirror the layout constants used by autoLayout.ts's layoutSequence (which writes the persisted
// positions this renderer draws from) -- kept as the same fixed values here so a unit test can lay
// the diagram out realistically without importing the layout module.
const COL_W = 260;
const ROW_H = 58;
const HEAD_H = 36;
const HEAD_W = 180;

function elementOf(id: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    render: "sequence",
    layer: "seq",
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

function participant(id: string, label: string, recipeKey: string): CanvasElement {
  return elementOf(id, {
    label,
    position: { x: 0, y: HEAD_H },
    size: { w: HEAD_W, h: HEAD_H },
    meta: { role: "participant", recipe_key: recipeKey },
  });
}

function message(
  id: string,
  from: string,
  to: string,
  order: number,
  extra: Record<string, unknown> = {},
): CanvasElement {
  return elementOf(id, {
    label: id,
    meta: { role: "message", from, to, order: String(order), ...extra },
  });
}

/** Lays out a set of [participant, message] elements the way layoutSequence would, so the renderer
 * sees real persisted geometry: assigns each participant the first-seen column, then back-fills each
 * message's midpoint from its sender/receiver columns. */
function layOut(elements: CanvasElement[]): CanvasElement[] {
  const cols = new Map<string, number>();
  for (const element of elements) {
    if (stringMeta(element, "role") !== "participant") continue;
    const ref = stringMeta(element, "recipe_key") ?? element.id;
    if (!cols.has(ref)) cols.set(ref, cols.size);
  }
  const result = elements.map((element) => {
    if (stringMeta(element, "role") !== "participant") return { ...element };
    const ref = stringMeta(element, "recipe_key") ?? element.id;
    const col = cols.get(ref) ?? 0;
    return { ...element, position: { x: col * COL_W + COL_W / 2, y: HEAD_H } };
  });
  for (let i = 0; i < result.length; i++) {
    const element = result[i];
    if (stringMeta(element, "role") !== "message") continue;
    const from = String(element.meta.from ?? "");
    const to = String(element.meta.to ?? "");
    const fromCol = cols.get(from) ?? 0;
    const toCol = cols.get(to) ?? 0;
    const order = Number(element.meta.order ?? 1) || 1;
    result[i] = {
      ...element,
      position: {
        x: (fromCol * COL_W + toCol * COL_W) / 2 + COL_W / 2,
        y: HEAD_H + ROW_H * (order - 1) + ROW_H / 2,
      },
    };
  }
  return result;
}

describe("SequenceDiagram", () => {
  it("renders one participant head per participant", () => {
    const elements = layOut([
      participant("p1", "Client", "client"),
      participant("p2", "API", "api"),
    ]);

    render(<SequenceDiagram layer="seq" elements={elements} />);

    const heads = screen.getAllByTestId("sequence-participant");
    expect(heads).toHaveLength(2);
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
  });

  it("orders messages by their meta.order (top-to-bottom)", () => {
    const elements = layOut([
      participant("p1", "Client", "client"),
      participant("p2", "API", "api"),
      message("m1", "client", "api", 1),
      message("m2", "api", "client", 2),
    ]);

    render(<SequenceDiagram layer="seq" elements={elements} />);

    const arrows = screen.getAllByTestId("sequence-message");
    expect(arrows).toHaveLength(2);
    const tops = arrows.map((arrow) => Number.parseFloat(arrow.style.top));
    expect(tops[0]).toBeLessThan(tops[1]);
  });

  it("renders a return arrow distinctly and labels it", () => {
    const elements = layOut([
      participant("p1", "Client", "client"),
      participant("p2", "API", "api"),
      message("m1", "client", "api", 1),
      message("m2", "api", "client", 2, { return: "true" }),
    ]);

    render(<SequenceDiagram layer="seq" elements={elements} />);

    const arrows = screen.getAllByTestId("sequence-message");
    expect(arrows).toHaveLength(2);
    expect(arrows[1].className).toContain("sequence-message--return");
    // A message's own label is rendered on its arrow.
    expect(screen.getByText("m2")).toBeInTheDocument();
  });

  it("renders a return arrow from a real-bridge boolean flag, not just the string form", () => {
    // The backend `recipes.py` emits `return`/`async` as JSON booleans; the mock's string `"true"`
    // is the other accepted form. Both must shape the arrow (H1 regression: `stringMeta` dropped
    // booleans, so a backend-authored return arrow silently rendered as a forward call).
    const elements = layOut([
      participant("p1", "Client", "client"),
      participant("p2", "API", "api"),
      message("m1", "client", "api", 1),
      message("m2", "api", "client", 2, { return: true, async: true }),
    ]);

    render(<SequenceDiagram layer="seq" elements={elements} />);

    const arrows = screen.getAllByTestId("sequence-message");
    expect(arrows[1].className).toContain("sequence-message--return");
    expect(arrows[1].className).toContain("sequence-message--async");
  });

  it("renders a plain forward call when the return flag is explicitly false", () => {
    // An explicit `false` (from `bool(item.get("return"))`) must NOT be treated as "return set".
    const elements = layOut([
      participant("p1", "Client", "client"),
      participant("p2", "API", "api"),
      message("m1", "client", "api", 1),
      message("m2", "client", "api", 2, { return: false }),
    ]);

    render(<SequenceDiagram layer="seq" elements={elements} />);

    const arrows = screen.getAllByTestId("sequence-message");
    expect(arrows[1].className).not.toContain("sequence-message--return");
  });

  it("drops a message whose from/to names no participant", () => {
    const elements = [
      participant("p1", "Client", "client"),
      message("m1", "client", "ghost", 1),
    ];

    render(<SequenceDiagram layer="seq" elements={elements} />);

    expect(screen.queryAllByTestId("sequence-message")).toHaveLength(0);
  });

  it("opens the description popup with a message's label and description on click", () => {
    const clicked: { title: string; description: string }[] = [];
    const unsub = descriptionPopupStore.subscribe(() => {
      const entry = descriptionPopupStore.getEntry();
      if (entry) clicked.push(entry);
    });
    const elements = layOut([
      participant("p1", "Client", "client"),
      participant("p2", "API", "api"),
      message("m1", "client", "api", 1),
    ]);
    // A message's request detail lives on the element's `description` field, like a box's.
    elements[2].description = "POST /checkout with cart payload";

    render(<SequenceDiagram layer="seq" elements={elements} />);
    fireEvent.click(screen.getByTestId("sequence-message"));

    const entry = clicked[clicked.length - 1];
    expect(entry).toEqual({
      title: "m1",
      description: "POST /checkout with cart payload",
    });
    unsub();
  });
});
