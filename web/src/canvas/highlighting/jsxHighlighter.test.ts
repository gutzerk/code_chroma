import { describe, expect, it } from "vitest";
import { jsxHighlighter } from "./jsxHighlighter";
import { javaHighlighter } from "./javaHighlighter";
import { typescriptHighlighter } from "./typescriptHighlighter";

describe("popular language highlighters", () => {
  it("tokenizes React JSX into classified tokens", () => {
    const tokens = jsxHighlighter.highlight(
      `const el = <div className="x">{items.map(i => <li>{i}</li>)}</div>;`,
    );
    const types = new Set(tokens.map((t) => t.type));
    expect(types.size).toBeGreaterThan(1);
    expect(types).not.toEqual(new Set(["plain"]));
  });

  it("tokenizes java into classified tokens", () => {
    const tokens = javaHighlighter.highlight('public class Foo { String s = "hi"; }');
    const types = new Set(tokens.map((t) => t.type));
    expect(types).toContain("keyword");
    expect(types).toContain("string");
  });

  it("tokenizes typescript into classified tokens", () => {
    const tokens = typescriptHighlighter.highlight("const x: number = 1; function f(a: string) {}");
    const types = new Set(tokens.map((t) => t.type));
    expect(types).toContain("keyword");
    expect(types).not.toEqual(new Set(["plain"]));
  });
});
