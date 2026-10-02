import type { LanguageHighlighter } from "./types";

/** Fallback strategy for any language without a real highlighter yet: no classification at all. */
export const plainTextHighlighter: LanguageHighlighter = {
  language: "plain",
  highlight(source: string) {
    return source.length > 0 ? [{ text: source, type: "plain" }] : [];
  },
};
