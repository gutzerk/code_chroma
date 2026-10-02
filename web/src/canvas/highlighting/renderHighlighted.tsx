import { getHighlighter } from "./registry";

/** Tokenizes `text` for `language` and renders the runs as `token-*` spans — the one place source
 * becomes highlighted markup, shared by the whole-panel code view and each diff line. */
export function renderHighlighted(text: string, language?: string) {
  return getHighlighter(language)
    .highlight(text)
    .map((token, index) => (
      <span key={index} className={`token-${token.type}`}>
        {token.text}
      </span>
    ));
}
