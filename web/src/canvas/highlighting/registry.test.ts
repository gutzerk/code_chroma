import { describe, expect, it } from "vitest";
import { getHighlighter } from "./registry";
import { pythonHighlighter } from "./pythonHighlighter";
import { goHighlighter } from "./goHighlighter";
import { yamlHighlighter } from "./yamlHighlighter";
import { javaHighlighter } from "./javaHighlighter";
import { typescriptHighlighter } from "./typescriptHighlighter";
import { javascriptHighlighter } from "./javascriptHighlighter";
import { jsxHighlighter } from "./jsxHighlighter";
import { plainTextHighlighter } from "./plainTextHighlighter";

describe("getHighlighter", () => {
  it("resolves python and its py alias to the python highlighter", () => {
    expect(getHighlighter("python")).toBe(pythonHighlighter);
    expect(getHighlighter("py")).toBe(pythonHighlighter);
    expect(getHighlighter("Python")).toBe(pythonHighlighter);
  });

  it("resolves go and its golang alias to the go highlighter", () => {
    expect(getHighlighter("go")).toBe(goHighlighter);
    expect(getHighlighter("golang")).toBe(goHighlighter);
    expect(getHighlighter("Go")).toBe(goHighlighter);
  });

  it("resolves yaml and its yml alias to the yaml highlighter", () => {
    expect(getHighlighter("yaml")).toBe(yamlHighlighter);
    expect(getHighlighter("yml")).toBe(yamlHighlighter);
    expect(getHighlighter("YAML")).toBe(yamlHighlighter);
  });

  it("resolves java to the java highlighter", () => {
    expect(getHighlighter("java")).toBe(javaHighlighter);
    expect(getHighlighter("Java")).toBe(javaHighlighter);
  });

  it("resolves typescript and its ts alias to the typescript highlighter", () => {
    expect(getHighlighter("typescript")).toBe(typescriptHighlighter);
    expect(getHighlighter("ts")).toBe(typescriptHighlighter);
    expect(getHighlighter("Typescript")).toBe(typescriptHighlighter);
  });

  it("resolves javascript and its aliases to the javascript highlighter", () => {
    expect(getHighlighter("javascript")).toBe(javascriptHighlighter);
    expect(getHighlighter("js")).toBe(javascriptHighlighter);
    expect(getHighlighter("node")).toBe(javascriptHighlighter);
  });

  it("resolves jsx/react to the jsx highlighter for React syntax", () => {
    expect(getHighlighter("jsx")).toBe(jsxHighlighter);
    expect(getHighlighter("react")).toBe(jsxHighlighter);
  });

  it("falls back to the plain-text highlighter for unknown or missing languages", () => {
    expect(getHighlighter("cobol")).toBe(plainTextHighlighter);
    expect(getHighlighter(undefined)).toBe(plainTextHighlighter);
  });
});
