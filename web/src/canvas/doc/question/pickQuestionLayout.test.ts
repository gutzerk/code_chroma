import { describe, expect, it } from "vitest";
import { pickQuestionLayout } from "./pickQuestionLayout";

describe("pickQuestionLayout", () => {
  it.each([
    { width: 1100, full: true, hasDiagram: false, expected: "B1" },
    { width: 1099, full: true, hasDiagram: true, expected: "A4" },
    { width: 1400, full: false, hasDiagram: true, expected: "A4" },
    { width: 880, full: false, hasDiagram: true, expected: "A4" },
    { width: 879, full: false, hasDiagram: true, expected: "A2" },
    { width: 1400, full: false, hasDiagram: false, expected: "A2" },
    { width: 320, full: true, hasDiagram: true, expected: "A2" },
  ])("$width wide, full=$full, diagram=$hasDiagram -> $expected", ({ expected, ...input }) => {
    const layout = pickQuestionLayout(input);

    expect(layout).toBe(expected);
  });
});
