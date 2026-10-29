import { useSyncExternalStore } from "react";
import type { CanvasElement } from "../../state/types";
import { DEFAULT_ELEMENT_SIZE } from "./elementRect";
import { isEpicsLayerName } from "./epicsLayout";
import { orderMeta, stringMeta } from "./elementMeta";
import { blockRoleFor } from "./blockRole";

// Render kinds with their own sizing; the layout leaves these to their dedicated code paths.
const SELF_SIZED = new Set<CanvasElement["render"]>(["epic", "sequence", "group", "note", "question"]);

// styles.css `.diagram-node-box*` metrics in px (root 16px): name 1.05rem, desc 0.7rem, 4-line clamp.
const NAME_FONT = '600 16.8px "DM Sans", system-ui, sans-serif';
const DESC_FONT = '400 11.2px "DM Sans", system-ui, sans-serif';
const NAME_LINE = 22;
const DESC_LINE = 14.6;
const DESC_CLAMP = 4;
// Header padding (2 * 0.7rem) + box border + title/buttons gap + the copy-button column.
const WIDTH_CHROME = 22.4 + 2 + 8 + 26;
// Header vertical padding (2 * 0.6rem) + border.
const HEIGHT_CHROME = 19.2 + 2;
// Description block: top hairline + padding-top + margin-top, and the title-wrap gap above it.
const DESC_CHROME = 1 + 8 + 2.4 + 11.2;
const TOP_BAND_H = 22;
const META_ROW_H = 36;
const FOOT_H = 22;

type Measure = (text: string) => number;

let ctx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();

// Widths measured before a web font loads use the fallback font, so a finished font load drops them and bumps this revision.
let fontRevision = 0;
const fontListeners = new Set<() => void>();
if (typeof document !== "undefined" && document.fonts) {
  document.fonts.addEventListener("loadingdone", () => {
    widthCache.clear();
    fontRevision += 1;
    fontListeners.forEach((listener) => listener());
  });
}

/** Changes after each web font load, so memos over measured text can recompute. */
export function useFontRevision(): number {
  return useSyncExternalStore(
    (listener) => {
      fontListeners.add(listener);
      return () => fontListeners.delete(listener);
    },
    () => fontRevision,
    () => 0,
  );
}

function context2d(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    const headless = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
    ctx = typeof document === "undefined" || headless ? null : document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  return ctx;
}

function measurer(font: string): Measure {
  const px = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? "12");
  const c = context2d();
  return (text) => {
    const key = `${font}|${text}`;
    const hit = widthCache.get(key);
    if (hit !== undefined) return hit;
    let width = text.length * px * 0.55;
    if (c) {
      c.font = font;
      const measured = c.measureText(text).width;
      if (measured > 0) width = measured;
    }
    widthCache.set(key, width);
    return width;
  };
}

/** Greedy word-wrap line count for `text` inside `maxWidth`, honoring explicit newlines. */
function lineCount(text: string, maxWidth: number, measure: Measure): number {
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    let current = "";
    let count = 1;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (current && measure(next) > maxWidth) {
        count += 1;
        current = word;
      } else {
        current = next;
      }
      // overflow-wrap: anywhere breaks a single over-long word across further lines.
      const extra = Math.floor(measure(current) / maxWidth);
      if (extra > 0 && !current.includes(" ")) count += extra;
    }
    lines += count;
  }
  return Math.max(lines, 1);
}

// Zoomed-out name fit (styles.css "Zoomed out: the name fills its box"): padding per side, line height, font bounds in px.
const FIT_PADDING = 10;
const FIT_LINE = 1.15;
const FIT_MIN = 8;
const FIT_MAX = 160;

const FIT_REF_PX = 100;
const fitMeasure = measurer(`600 ${FIT_REF_PX}px "DM Sans", system-ui, sans-serif`);

/** True when `text` set at `px` fits `w` x `h`; `breakWords` allows splitting a word too long for a line. */
function nameFits(text: string, px: number, w: number, h: number, breakWords: boolean): boolean {
  // Text width scales linearly with font size, so measure once at FIT_REF_PX and scale: one cache entry per text, not one per probed size.
  const measure: Measure = (t) => (fitMeasure(t) * px) / FIT_REF_PX;
  if (!breakWords && text.split(/\s+/).some((word) => measure(word) > w)) return false;
  return lineCount(text, w, measure) * px * FIT_LINE <= h;
}

/** The largest name font size (px) that fills a `w` x `h` box, whole words first, split words only as a fallback. */
export function fitNameFontSize(label: string, w: number, h: number): number {
  const innerW = Math.max(w - FIT_PADDING * 2, 1);
  const innerH = Math.max(h - FIT_PADDING * 2, 1);
  const text = label.trim() || " ";
  for (const breakWords of [false, true]) {
    let lo = FIT_MIN;
    let hi = Math.min(FIT_MAX, Math.floor(innerH / FIT_LINE));
    if (hi < lo || !nameFits(text, lo, innerW, innerH, breakWords)) continue;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (nameFits(text, mid, innerW, innerH, breakWords)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  return FIT_MIN;
}

/** One zoomed-out name size per layer: the smallest per-box fit, so every box in a diagram shows its name at the same size. */
export function layerFitNameSizes(elements: readonly CanvasElement[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const element of elements) {
    const px = fitNameFontSize(element.label, element.size?.w ?? DEFAULT_ELEMENT_SIZE.w, element.size?.h ?? DEFAULT_ELEMENT_SIZE.h);
    sizes.set(element.layer, Math.min(sizes.get(element.layer) ?? FIT_MAX, px));
  }
  return sizes;
}

/** Estimated {w,h} for an element's box, or `null` for kinds that size themselves. An authored
 * `element.size` always wins; the measure only fills in for `size == null`. */
export function measureBoxSize(element: CanvasElement): { w: number; h: number } | null {
  if (SELF_SIZED.has(element.render)) return null;
  if (element.size) return { w: element.size.w, h: element.size.h };
  if (isRoleBox(element)) return { w: DEFAULT_ELEMENT_SIZE.w, h: roleBoxHeight(element, DEFAULT_ELEMENT_SIZE.w) };
  const w = DEFAULT_ELEMENT_SIZE.w;
  const textWidth = Math.max(w - WIDTH_CHROME, 40);

  let h = HEIGHT_CHROME;
  h += lineCount(element.label, textWidth, measurer(NAME_FONT)) * NAME_LINE;
  if (element.description) {
    const lines = Math.min(lineCount(element.description, textWidth, measurer(DESC_FONT)), DESC_CLAMP);
    h += DESC_CHROME + lines * DESC_LINE;
  }
  if (orderMeta(element) || stringMeta(element, "plan_kind")) h += TOP_BAND_H;
  if (blockRoleFor(element) || stringMeta(element, "kind") || stringMeta(element, "status") || stringMeta(element, "no_code_reason")) {
    h += META_ROW_H;
  }
  if (stringMeta(element, "path")) h += FOOT_H;
  return { w, h: Math.ceil(Math.max(h, DEFAULT_ELEMENT_SIZE.h)) };
}

// Role-box anatomy (styles.css `.block-role*`, DOM-measured at full zoom): each row's height plus its margin-top.
const ROLE_NAME_FONT = '600 18.4px "DM Sans", system-ui, sans-serif';
const ROLE_PAD = 9.6;
const ROLE_SRC_PAD = 24;
const ROLE_BORDER = 3;
const ROLE_ROW_GAP = 11.2;
const ROLE_HEADER_ROW = 26;
const ROLE_NAME_LINE = 24;
const ROLE_NAME_MARGIN = 1.6;
const ROLE_DESC_ROW = 18 + 2.4;
const ROLE_PATH_ROW = 15 + 4.8;
const ROLE_MEMBERS_ROW = 18 + 4.8;

/** True when CanvasNodeBox draws this element as a role block (role header row, one-line description). */
function isRoleBox(element: CanvasElement): boolean {
  return !isEpicsLayerName(element.layer) && blockRoleFor(element) !== undefined;
}

/** A role block's height: role header, name, one-line description, path footer, members chip and SRC corner. */
function roleBoxHeight(element: CanvasElement, w: number): number {
  const textWidth = Math.max(w - WIDTH_CHROME, 40);
  const nameLines = lineCount(element.label, textWidth, measurer(ROLE_NAME_FONT));
  const rows = [ROLE_HEADER_ROW, nameLines * ROLE_NAME_LINE + ROLE_NAME_MARGIN];
  if (element.description) rows.push(ROLE_DESC_ROW);
  if (stringMeta(element, "path")) rows.push(ROLE_PATH_ROW);
  // A code-backed box shows the members chip (member count loads later, so reserve it) and the SRC corner.
  if (element.node_id) rows.push(ROLE_MEMBERS_ROW);
  let h = ROLE_PAD + (element.node_id ? ROLE_SRC_PAD : ROLE_PAD) + ROLE_BORDER;
  h += rows.reduce((sum, row) => sum + row, 0) + ROLE_ROW_GAP * (rows.length - 1);
  if (orderMeta(element) || stringMeta(element, "plan_kind")) h += TOP_BAND_H;
  return Math.ceil(Math.max(h, DEFAULT_ELEMENT_SIZE.h));
}

/** The footprint layout must reserve: a role box's stored size is only CanvasNodeBox's `minHeight`, so it grows to its content. */
export function layoutBoxSize(element: CanvasElement): { w: number; h: number } | null {
  const measured = measureBoxSize(element);
  if (!measured || !element.size || !isRoleBox(element)) return measured;
  return { w: measured.w, h: Math.max(measured.h, roleBoxHeight(element, measured.w)) };
}
