import type { CSSProperties } from "react";

/** The CSS properties an authored diagram node may set via its `style` field — a strict allow-list
 * shared by every authored diagram kind (impact, patterns, custom, …). Position/size/z-index/… are
 * excluded on purpose: a bad authored value can tint a box but never break canvas layout. Values
 * pass through verbatim — the skill owns them, the allow-list only gates *which* keys. */
const STYLE_ALLOWLIST: Record<string, keyof CSSProperties> = {
  color: "color",
  "border-color": "borderColor",
  background: "backgroundColor",
  "border-style": "borderStyle",
};

/** The raw allowed key names, for a caller (mockBridge) sanitizing before storing, not rendering. */
export const STYLE_ALLOWED_KEYS: readonly string[] = Object.keys(STYLE_ALLOWLIST);

/** The safe inline-style for an authored diagram node *or edge*: only allow-listed properties that
 * carry a non-empty string value survive; everything else (bad keys, non-string values, empty
 * strings, a non-object `style`) is dropped, returning undefined. One allow-list is shared by
 * Element and Edge on the backend (`_sanitize_style`), so the filter is shared here too — an edge
 * simply only meaningfully uses `color`. */
export function authoredStyle(style: unknown): CSSProperties | undefined {
  if (!style || typeof style !== "object") return undefined;
  const props: CSSProperties = {};
  let any = false;
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const prop = STYLE_ALLOWLIST[key];
    if (!prop) continue;
    (props as Record<string, string>)[prop] = value;
    any = true;
  }
  return any ? props : undefined;
}
