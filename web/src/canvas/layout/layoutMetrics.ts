import type { AgentsMode } from "./layoutStore";

export const Z_LEFT_PANEL = 2;
export const Z_AGENTS = 3;
export const Z_COLLAPSED_LEFT_BAR = 4;
export const Z_CODE = 5;
export const Z_POPOVER = 6;

/** Gap (px) between the canvas-area edge and floating chrome (left panel, collapsed bars). */
const CHROME_INSET = 12;
const LEFT_PANEL_WIDTH = 262;
/** Breathing room between the open left panel and whatever sits beside it. */
const LEFT_PANEL_GAP = 12;
/** Left edge (px) of in-flow content when the left panel is open. */
const LEFT_PANEL_CLEARANCE = CHROME_INSET + LEFT_PANEL_WIDTH + LEFT_PANEL_GAP;
/** Right inset (px) taken by the agents panel in normal mode. */
const AGENTS_NORMAL_INSET = 424;
/** Right inset (px) taken by the agents handle strip when collapsed or full. */
export const AGENTS_COLLAPSED_INSET = 68;
/** Gap (px) between the canvas-area right edge and the stretched agents panel. */
export const AGENTS_WIDE_RIGHT_GAP = 12;
/** Narrowest width (px) the stretched agents panel may take. */
export const AGENTS_WIDE_MIN_WIDTH = 400;
export const ARRANGE_X_OPEN = LEFT_PANEL_CLEARANCE + 4;
export const ARRANGE_X_CLOSED = 28;
export const ARRANGE_Y_OPEN = 28;
export const ARRANGE_Y_CLOSED = 76;

/** CSS custom properties set once on `.canvas-area` so stylesheets share these exact values. */
export const LAYOUT_CSS_VARS = {
  "--chrome-inset": `${CHROME_INSET}px`,
  "--left-panel-width": `${LEFT_PANEL_WIDTH}px`,
} as const;

export interface ChromeInsetsInput {
  leftOpen: boolean;
  agentsMode: AgentsMode;
}

export interface ChromeInsets {
  terminalLeft: number;
  terminalRight: number;
  arrangeOrigin: { x: number; y: number };
}

/** Pure chrome offsets (px) derived from the left panel and agents panel state. */
export function chromeInsets(state: ChromeInsetsInput): ChromeInsets {
  const { leftOpen, agentsMode } = state;
  return {
    terminalLeft: leftOpen ? LEFT_PANEL_CLEARANCE : CHROME_INSET,
    terminalRight: agentsMode === "normal" ? AGENTS_NORMAL_INSET : AGENTS_COLLAPSED_INSET,
    arrangeOrigin: { x: leftOpen ? ARRANGE_X_OPEN : ARRANGE_X_CLOSED, y: leftOpen ? ARRANGE_Y_OPEN : ARRANGE_Y_CLOSED },
  };
}

/** Width (px) of the full-screen agents panel: from the left panel edge (or the chrome inset when it is closed) to the right gap. */
export function agentsWideWidth(areaWidth: number, leftOpen: boolean): number {
  const leftEdge = chromeInsets({ leftOpen, agentsMode: "normal" }).terminalLeft;
  return Math.max(AGENTS_WIDE_MIN_WIDTH, Math.round(areaWidth - leftEdge - AGENTS_WIDE_RIGHT_GAP));
}
