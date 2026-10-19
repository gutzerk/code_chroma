import { describe, expect, it } from "vitest";
import type { CanvasElement } from "../../../state/types";
import { sessionHistory, toQuestionView } from "./questionAdapter";
import { WIRE_OPTIONS } from "./fixtures";

function el(id: string, meta: Record<string, unknown>): CanvasElement {
  return {
    id, render: "question", layer: "questions", label: `Q ${id}`, description: "", node_id: null,
    position: { x: 0, y: 0 }, size: null, group_id: null, meta, created_by: "ai",
  };
}

describe("questionAdapter", () => {
  it("maps wire meta to a view, defaulting a bare meta to an open question", () => {
    const full = toQuestionView(
      el("a", { question_id: "qa", state: "answered", answer: "x", session_id: "s", step: 1, total: 3, options: WIRE_OPTIONS }),
    );
    const bare = toQuestionView(el("b", {}));

    expect(full).toMatchObject({ questionId: "qa", state: "answered", answer: "x", step: 1, total: 3 });
    expect(full.options[1].diagramRef).toBe("el-9");
    expect(bare).toMatchObject({ questionId: "b", state: "open", options: [], allowCustom: true });
  });

  it("collects only closed same-session questions ordered by step", () => {
    const elements = {
      a: el("a", { session_id: "s", step: 2, state: "answered", answer: "2" }),
      b: el("b", { session_id: "s", step: 1, state: "skipped" }),
      c: el("c", { session_id: "other", step: 1, state: "answered" }),
      d: el("d", { session_id: "s", step: 3, state: "open" }),
    };

    const history = sessionHistory(elements, toQuestionView(elements.d));

    expect(history.map((q) => q.elementId)).toEqual(["b", "a"]);
  });
});
