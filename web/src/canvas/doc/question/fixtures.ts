import type { QuestionOption, QuestionView } from "./questionAdapter";

export const OPTIONS: QuestionOption[] = [
  { id: "a", title: "Modular monolith", description: "One deployment", pro: "Simple", con: "Shared release", rank: 1, why: "Fits an MVP", diagramRef: null },
  { id: "b", title: "Services", description: "Independent", pro: "Scalable", con: "Coordination", rank: 2, why: "Adds work", diagramRef: "el-9" },
  { id: "c", title: "Events", description: "Async", pro: "Decoupled", con: "Complexity", rank: 3, why: "Too heavy", diagramRef: null },
];

/** Wire-shaped options (snake_case) as they sit in a question element's `meta.options`. */
export const WIRE_OPTIONS = OPTIONS.map((o) => ({
  id: o.id, title: o.title, description: o.description, pro: o.pro, con: o.con,
  rank: o.rank, why: o.why, diagram_ref: o.diagramRef,
}));

export function viewOf(overrides: Partial<QuestionView> = {}): QuestionView {
  return {
    questionId: "q1", elementId: "q1", title: "How should checkout be structured?", state: "open",
    answer: null, sessionId: "s1", step: 2, total: 4, options: OPTIONS, allowCustom: true, allowSkip: true,
    diagramRequested: false, diagramRequests: 0,
    ...overrides,
  };
}
