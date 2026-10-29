import type { CanvasElement } from "../../state/types";
import { stringMeta } from "./elementMeta";
import type { RouteStep } from "./routeStep";
import { WALKTHROUGH_LAYER } from "./walkthroughLayout";

/** What a walkthrough box shows (B2 board): its one-line name, an optional small line above it and an inline tag. */
export interface WalkthroughBoxText {
  name: string;
  kicker?: string;
  tag?: "AI" | "EXTERNAL";
  /** A box outside the route: an external system, a data store, or anything else (an actor, a note). */
  variant?: "external" | "data" | "other";
}

const DATA_SHAPES = new Set(["database", "storage", "cache", "data", "store"]);

/** True for a data store box, by its authored `shape` or `kind`. */
function isDataStore(element: CanvasElement): boolean {
  return DATA_SHAPES.has(stringMeta(element, "shape") ?? "") || DATA_SHAPES.has(stringMeta(element, "kind") ?? "");
}

/** True for an external system box: `no_code_reason: "external"` or `meta.external`. */
function isExternal(element: CanvasElement): boolean {
  return stringMeta(element, "no_code_reason") === "external" || element.meta?.external === true;
}

/** The B2 text of a walkthrough box, or undefined for a box on any other layer. */
export function walkthroughBoxText(element: CanvasElement, step: RouteStep | undefined): WalkthroughBoxText | undefined {
  if (element.layer !== WALKTHROUGH_LAYER) return undefined;
  if (!step) {
    if (isExternal(element)) return { name: element.label, tag: "EXTERNAL", variant: "external" };
    return { name: element.label, variant: isDataStore(element) ? "data" : "other" };
  }
  if (step.kind === "trigger") return { name: element.label, kicker: step.lane };
  if (step.kind === "failure") return { name: `✕ ${element.label}` };
  // A code step names the function it runs, as on the code map; the step title stays in the ROUTE panel.
  const code = step.nodeIds.length > 0 && step.detail ? step.detail.replace(/\s*[,·]\s*AI$/i, "") : undefined;
  return { name: code || element.label, tag: step.kind === "ai" ? "AI" : undefined };
}
