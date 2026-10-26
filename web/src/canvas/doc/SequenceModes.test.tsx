import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { SequenceDiagram } from "./SequenceDiagram";
import { sequenceViewStore } from "./sequenceViewStore";
import { EMPTY_CANVAS_DOC, type CanvasElement } from "../../state/types";
import { viewSequenceElements } from "./autoLayout";

function el(id: string, meta: Record<string, unknown>, x: number, y: number): CanvasElement {
  return {
    id, render: "sequence", layer: "seq", label: id, description: "", node_id: null,
    position: { x, y }, size: null, group_id: null, meta, created_by: "ai",
  };
}

const phases = [{ id: "p1", name: "Prepare", kind: "prepare", from_order: 1, to_order: 2 }];
const elements = [
  el("c", { role: "participant", recipe_key: "c", phases }, 130, 36),
  el("a", { role: "participant", recipe_key: "a" }, 390, 36),
  el("m1", { role: "message", from: "c", to: "a", order: "1" }, 260, 90),
  el("m2", { role: "message", from: "a", to: "c", order: "2", return: true }, 260, 148),
  el("m3", { role: "message", from: "c", to: "a", order: "3" }, 260, 206),
];

describe("sequence modes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    sequenceViewStore.reset();
  });

  it("renders readable by default with phase bands", () => {
    render(<SequenceDiagram layer="seq" elements={elements} />);

    expect(screen.getByTestId("sequence-diagram").dataset.mode).toBe("readable");
    expect(screen.getByTestId("sequence-phase-band")).toBeTruthy();
    expect(screen.getAllByTestId("sequence-message")).toHaveLength(3);
  });

  it("switches to focus in place and hides collapsed phase messages", () => {
    render(<SequenceDiagram layer="seq" elements={elements} />);

    act(() => {
      sequenceViewStore.setMode("seq", "focus");
      sequenceViewStore.setCollapsed("seq", ["p1"]);
    });

    expect(screen.getByTestId("sequence-diagram").dataset.mode).toBe("focus");
    expect(screen.getAllByTestId("sequence-message")).toHaveLength(1);
    expect(screen.getByTestId("sequence-phase-row").textContent).toContain("2 calls");
  });
});

describe("sequence player", () => {
  beforeEach(() => {
    window.localStorage.clear();
    sequenceViewStore.reset();
  });

  it("fades messages after the current step and lights the current one", () => {
    sequenceViewStore.setStep("seq", 2);

    render(<SequenceDiagram layer="seq" elements={elements} />);

    const messages = screen.getAllByTestId("sequence-message");
    expect(messages[1].className).toContain("sequence-message--active");
    expect(messages[2].className).toContain("sequence-message--dim");
    expect(messages[0].className).not.toContain("sequence-message--dim");
    sequenceViewStore.setStep("seq", null);
  });
});

describe("viewSequenceElements", () => {
  it("folds a collapsed phase in focus mode without touching the doc", () => {
    const doc = { ...EMPTY_CANVAS_DOC, elements: Object.fromEntries(elements.map((e) => [e.id, e])) };
    const ids = elements.map((e) => e.id);

    const derived = viewSequenceElements(doc, ids, { mode: "focus", collapsed: ["p1"], focus: null });

    const y = (id: string) => derived.find((e) => e.id === id)?.position.y;
    expect(y("m1")).toBe(y("m2"));
    expect(doc.elements.m2.position.y).toBe(148);
  });
});
