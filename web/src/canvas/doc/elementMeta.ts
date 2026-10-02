import type { CanvasElement } from "../../state/types";

/** Reads a string-typed `meta` key off a box, or `undefined` for anything else (missing, empty,
 * non-string) -- the one place every meta-driven accent/badge/layout-input reads a box's free-form
 * `meta` bag from, so the "must be a non-empty string" check lives in exactly one place. */
export function stringMeta(element: CanvasElement, key: string): string | undefined {
  const value = element.meta[key];
  return typeof value === "string" && value ? value : undefined;
}

/** The leading run of ASCII digits in an authored `order` string, normalized to its plain numeric
 * form (e.g. `"2a"` -> `"2"`, and a stray `"02a"` -> `"2"` too, not `"02"`), or `undefined` for empty/
 * non-numeric input -- shared by `layeredLayout.ts`'s rank parser and `CanvasDocView.tsx`'s
 * Concurrency island grouping (054-diagram-flow-order) so both "same leading digit" comparisons use
 * one identical rule instead of two regexes that could drift apart. The normalization matters for the
 * second caller specifically: without it, `"2a"` and `"02b"` would parse to the same layout rank (both
 * go through `Number.parseInt` downstream) but fail to group into the same Concurrency island (a raw
 * string comparison would see `"2"` and `"02"` as different keys). */
export function leadingOrderDigits(order: string | undefined): string | undefined {
  if (!order) return undefined;
  const match = /^\d+/.exec(order);
  return match ? String(Number.parseInt(match[0], 10)) : undefined;
}
