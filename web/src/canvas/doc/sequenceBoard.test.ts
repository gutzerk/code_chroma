import { describe, expect, it } from "vitest";
import { buildSequenceBoard, SEQUENCE_BOARD, sequenceBoardBounds, stepTone } from "./sequenceBoard";
import { buildSequenceModel } from "./sequenceModel";
import { laidOut, messageEl, participantEl } from "./sequenceTestElements";

const phases = [
  { id: "p1", name: "Trigger", kind: "prepare", from_order: 1, to_order: 2 },
  { id: "p2", name: "Write", kind: "ai", from_order: 3, to_order: 4 },
];

const flow = () => [
  participantEl("user", "actor", { meta: { role: "participant", recipe_key: "user", kind: "actor", phases } }),
  participantEl("api", "api"),
  participantEl("llm", "ai"),
  messageEl("m1", "user", "api", "1"),
  messageEl("m2", "api", "llm", "2"),
  messageEl("m3", "llm", "api", "3", { kind: "ai" }),
  messageEl("m4", "api", "user", "4", { async: true }),
  messageEl("mx", "api", "user", "2a", { kind: "error" }),
];

describe("buildSequenceBoard", () => {
  it("gives every participant a numbered lane and failures their own lane", () => {
    const board = buildSequenceBoard(flow());

    expect(board.lanes.map((l) => l.label)).toEqual(["01 / USER", "02 / API", "03 / LLM", "EX / Failures"]);
    expect(board.lanes.map((l) => l.tone)).toEqual(["plain", "plain", "ai", "fail"]);
  });

  it("puts each step in its sender's lane, one column per step in order", () => {
    const board = buildSequenceBoard(flow());
    const step = (id: string) => board.steps.find((s) => s.id === id);

    expect(step("m1")?.lane.label).toBe("01 / USER");
    expect(step("m3")?.lane.label).toBe("03 / LLM");
    expect([step("m1"), step("m2"), step("m3")].map((s) => s?.rect.x)).toEqual([140, 274, 408]);
  });

  it("draws the first and last step as START/END pills and numbers the rest", () => {
    const board = buildSequenceBoard(flow());

    expect(board.steps.filter((s) => s.lane.tone !== "fail").map((s) => [s.shape, s.number])).toEqual([
      ["start", ""],
      ["step", "01"],
      ["step", "02"],
      ["end", ""],
    ]);
  });

  it("hangs a failure under the step it branches from with a dashed failure arrow", () => {
    const board = buildSequenceBoard(flow());
    const failure = board.steps.find((s) => s.id === "mx");

    expect(failure?.rect.x).toBe(274);
    expect(board.arrows.filter((a) => a.kind === "fail")).toHaveLength(1);
  });

  it("links steps with main arrows and draws an async step's arrow as a side effect", () => {
    const board = buildSequenceBoard(flow());

    expect(board.arrows.filter((a) => a.kind !== "fail").map((a) => a.kind)).toEqual(["main", "main", "side"]);
  });

  it("expands a step in place: its column and lane grow and later columns shift right", () => {
    const glance = buildSequenceBoard(flow());
    const open = buildSequenceBoard(flow(), ["m2"]);
    const x = (b: typeof open, id: string) => b.steps.find((s) => s.id === id)?.rect.x ?? 0;

    expect(open.steps.find((s) => s.id === "m2")?.rect).toMatchObject({ w: SEQUENCE_BOARD.expandedW, h: SEQUENCE_BOARD.expandedH });
    expect(x(open, "m3") - x(glance, "m3")).toBe(SEQUENCE_BOARD.expandedW - SEQUENCE_BOARD.boxW);
    expect(open.lanes[1].rect.h).toBe(264);
  });

  it("spans a phase pill over the columns of its steps", () => {
    const board = buildSequenceBoard(flow());

    expect(board.pills.map((p) => [p.label, p.x, p.w])).toEqual([
      ["Trigger", 140, 250],
      ["Write", 408, 250],
    ]);
  });

  it("reports the whole board's document rect from laid-out members", () => {
    const members = laidOut(flow(), { x: 500, y: 300 });
    const board = buildSequenceBoard(members);

    expect(sequenceBoardBounds(members, [])).toEqual({ left: 500, top: 300, right: 500 + board.width, bottom: 300 + board.height });
  });
});

describe("stepTone", () => {
  it.each([
    ["m1", "actor"],
    ["m2", "route"],
    ["m3", "ai"],
    ["mx", "fail"],
  ])("colours %s as %s", (id, tone) => {
    const model = buildSequenceModel(flow());
    const message = model.messages.find((m) => m.element.id === id);
    const byRef = new Map(model.participants.map((p) => [p.ref, p]));

    expect(message && stepTone(message, byRef.get(message.fromRef), byRef.get(message.toRef))).toBe(tone);
  });
});
