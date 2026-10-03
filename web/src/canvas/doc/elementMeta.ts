import type { CanvasElement } from "../../state/types";

/** Reads a string-typed `meta` key off a box, or `undefined` for anything else (missing, empty,
 * non-string) -- the one place every meta-driven accent/badge/layout-input reads a box's free-form
 * `meta` bag from, so the "must be a non-empty string" check lives in exactly one place. */
export function stringMeta(element: CanvasElement, key: string): string | undefined {
  const value = element.meta[key];
  return typeof value === "string" && value ? value : undefined;
}

/** Reads a `meta` key that may be a string or a number, or `undefined` for anything else — `stringMeta`
 * alone (string-only) would drop a numeric authored value like an `order`. Shared by the sequence
 * layout and renderer, which both read author-authored `order`/`from`/`to` that can arrive as either. */
export function rawMeta(element: CanvasElement, key: string): string | number | undefined {
  const value = element.meta[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

/** Whether a `meta` key reads as a set boolean-ish flag. The sequence backend emits `return`/`async`
 * as real JSON booleans (`bool(...)` in recipes.py), while authored/mock files use a `"true"` string —
 * so a truthiness-aware read (string non-empty, number non-zero, or literal boolean true) is the only
 * form that survives both paths. `stringMeta` can't be used here: it drops booleans and the empty
 * string, and an explicitly-false boolean would be indistinguishable from a missing flag. */
export function flagMeta(element: CanvasElement, key: string): boolean {
  const value = element.meta[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value !== "";
  if (typeof value === "number") return value !== 0;
  return false;
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
