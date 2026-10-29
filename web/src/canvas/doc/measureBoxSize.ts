import type { CanvasElement } from "../../state/types";
import { DEFAULT_ELEMENT_SIZE } from "./elementRect";
import { orderMeta, stringMeta } from "./elementMeta";
import { routeStepOf } from "./routeStep";
import { walkthroughBoxText } from "./walkthroughBox";

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

// B2 board box metrics (styles.css "026 walkthrough"): name font, horizontal chrome, minimum width and fixed height.
const WALKTHROUGH_BOXES = {
  step: { font: '600 12px "JetBrains Mono", monospace', chrome: 26 + 3, minW: 160, h: 40 },
  trigger: { font: '600 13.5px Inter, "DM Sans", sans-serif', chrome: 36 + 3, minW: 150, h: 56 },
  failure: { font: '600 12px Inter, "DM Sans", sans-serif', chrome: 20 + 2, minW: 186, h: 28 },
  other: { font: '600 13.5px Inter, "DM Sans", sans-serif', chrome: 32 + 3, minW: 300, h: 80 },
} as const;
const WALKTHROUGH_TAG_W = 34;

/** A walkthrough box's B2 size: one-line name, so only the width follows the text. */
function walkthroughBoxSize(element: CanvasElement): { w: number; h: number } | null {
  const step = routeStepOf(element);
  const text = walkthroughBoxText(element, step);
  if (!text) return null;
  const metrics = !step ? WALKTHROUGH_BOXES.other : step.kind === "trigger" ? WALKTHROUGH_BOXES.trigger : step.kind === "failure" ? WALKTHROUGH_BOXES.failure : WALKTHROUGH_BOXES.step;
  const textW = measurer(metrics.font)(text.name) + (text.tag ? WALKTHROUGH_TAG_W : 0);
  return { w: Math.ceil(Math.max(metrics.minW, textW + metrics.chrome)), h: metrics.h };
}

/** Estimated {w,h} for an element's box, or `null` for kinds that size themselves. An authored
 * `element.size` always wins; the measure only fills in for `size == null`. */
export function measureBoxSize(element: CanvasElement): { w: number; h: number } | null {
  if (SELF_SIZED.has(element.render)) return null;
  if (element.size) return { w: element.size.w, h: element.size.h };
  const walkthrough = walkthroughBoxSize(element);
  if (walkthrough) return walkthrough;
  const w = DEFAULT_ELEMENT_SIZE.w;
  const textWidth = Math.max(w - WIDTH_CHROME, 40);

  let h = HEIGHT_CHROME;
  h += lineCount(element.label, textWidth, measurer(NAME_FONT)) * NAME_LINE;
  if (element.description) {
    const lines = Math.min(lineCount(element.description, textWidth, measurer(DESC_FONT)), DESC_CLAMP);
    h += DESC_CHROME + lines * DESC_LINE;
  }
  if (orderMeta(element) || stringMeta(element, "plan_kind")) h += TOP_BAND_H;
  if (stringMeta(element, "kind") || stringMeta(element, "status") || stringMeta(element, "no_code_reason")) {
    h += META_ROW_H;
  }
  if (stringMeta(element, "path")) h += FOOT_H;
  return { w, h: Math.ceil(Math.max(h, DEFAULT_ELEMENT_SIZE.h)) };
}
