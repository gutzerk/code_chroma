import { describe, expect, it } from "vitest";
import { goHighlighter } from "./goHighlighter";

describe("goHighlighter", () => {
  it("classifies keywords, strings, comments, and function names", () => {
    const source = [
      "// say hi",
      "func greet(name string) string {",
      '    return "hello " + name',
      "}",
    ].join("\n");

    const tokens = goHighlighter.highlight(source);
    const byType = (type: string) => tokens.filter((t) => t.type === type).map((t) => t.text);

    expect(byType("keyword")).toEqual(expect.arrayContaining(["func", "return"]));
    expect(byType("comment").join("")).toContain("say hi");
    expect(byType("string").join("")).toContain("hello");
    expect(byType("function")).toEqual(expect.arrayContaining(["greet"]));
  });

  it("reassembles to the original source", () => {
    const source = "func add(a, b int) int {\n    return a + b\n}\n";
    const tokens = goHighlighter.highlight(source);
    expect(tokens.map((t) => t.text).join("")).toBe(source);
  });
});
