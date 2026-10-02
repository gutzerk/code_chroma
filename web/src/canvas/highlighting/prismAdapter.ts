import Prism from "prismjs";
import type { HighlightToken, LanguageHighlighter } from "./types";

/** Maps Prism's per-grammar token type strings onto our small fixed set of `token-*` CSS classes. */
const TYPE_MAP: Record<string, string> = {
  keyword: "keyword",
  builtin: "keyword",
  boolean: "keyword",
  decorator: "keyword",
  string: "string",
  "triple-quoted-string": "string",
  "string-interpolation": "string",
  comment: "comment",
  number: "number",
  function: "function",
  "class-name": "function",
  operator: "operator",
  punctuation: "punctuation",
  scalar: "string",
  key: "keyword",
  tag: "keyword",
  important: "keyword",
  directive: "keyword",
  datetime: "number",
  null: "keyword",
};

function mapType(prismType: string): string {
  return TYPE_MAP[prismType] ?? "plain";
}

function flatten(input: string | Prism.Token, inheritedType: string, out: HighlightToken[]): void {
  if (typeof input === "string") {
    if (input.length > 0) out.push({ text: input, type: inheritedType });
    return;
  }
  const type = mapType(input.type);
  const content = input.content;
  if (typeof content === "string") {
    if (content.length > 0) out.push({ text: content, type });
  } else if (Array.isArray(content)) {
    for (const child of content) flatten(child, type, out);
  } else {
    flatten(content, type, out);
  }
}

/** Adapter: wraps a Prism grammar behind our own LanguageHighlighter/HighlightToken shape. */
export function createPrismHighlighter(language: string, grammar: Prism.Grammar): LanguageHighlighter {
  return {
    language,
    highlight(source: string): HighlightToken[] {
      const out: HighlightToken[] = [];
      for (const token of Prism.tokenize(source, grammar)) flatten(token, "plain", out);
      return out;
    },
  };
}
