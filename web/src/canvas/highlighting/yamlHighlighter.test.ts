import { describe, expect, it } from "vitest";
import { yamlHighlighter } from "./yamlHighlighter";

describe("yamlHighlighter", () => {
  it("classifies keys, strings, comments, and booleans", () => {
    const source = [
      "# service config",
      'name: "codechroma"',
      "enabled: true",
      "tags:",
      "  - core",
    ].join("\n");

    const tokens = yamlHighlighter.highlight(source);
    const byType = (type: string) => tokens.filter((t) => t.type === type).map((t) => t.text);

    expect(byType("comment").join("")).toContain("service config");
    expect(byType("keyword")).toEqual(expect.arrayContaining(["name", "enabled"]));
    expect(byType("string").join("")).toContain("codechroma");
    expect(byType("keyword")).toEqual(expect.arrayContaining(["true"]));
  });

  it("reassembles to the original source", () => {
    const source = "name: codechroma\nversion: 1\n";
    const tokens = yamlHighlighter.highlight(source);
    expect(tokens.map((t) => t.text).join("")).toBe(source);
  });
});
