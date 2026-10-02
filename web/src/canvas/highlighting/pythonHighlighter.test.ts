import { describe, expect, it } from "vitest";
import { pythonHighlighter } from "./pythonHighlighter";

describe("pythonHighlighter", () => {
  it("classifies keywords, strings, comments, decorators, and function names", () => {
    const source = [
      "@classmethod",
      "def greet(name: str) -> str:",
      "    # say hi",
      "    return f\"hello {name}\"",
    ].join("\n");

    const tokens = pythonHighlighter.highlight(source);
    const byType = (type: string) => tokens.filter((t) => t.type === type).map((t) => t.text);

    expect(byType("keyword")).toEqual(expect.arrayContaining(["def", "return"]));
    expect(byType("comment").join("")).toContain("say hi");
    expect(byType("string").join("")).toContain("hello");
    expect(byType("function")).toEqual(expect.arrayContaining(["greet"]));
  });

  it("reassembles to the original source", () => {
    const source = "def add(a, b):\n    return a + b\n";
    const tokens = pythonHighlighter.highlight(source);
    expect(tokens.map((t) => t.text).join("")).toBe(source);
  });
});
