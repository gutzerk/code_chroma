/** One classified chunk of source text; `type` maps 1:1 to a `token-<type>` CSS class. */
export interface HighlightToken {
  text: string;
  type: string;
}

/** Strategy: turns a source string into a flat token stream for one language. */
export interface LanguageHighlighter {
  language: string;
  highlight(source: string): HighlightToken[];
}
