import type { ComponentType } from "react";
import type { CanvasDoc, CanvasEdge, CanvasElement, CanvasPosition, CanvasSize } from "../../state/types";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import type { UnionBounds } from "./boundingBox";
import type { EdgeVisual } from "./edgeKinds";
import type { Route } from "./routeStep";
import { SEQUENCE_PROFILE } from "./sequenceProfile";
import { WALKTHROUGH_PROFILE } from "./walkthroughProfile";

/** What a profile's `frameBounds` may read besides the members' own bounds. */
export interface FrameCtx {
  layer: string;
  members: readonly CanvasElement[];
  /** The route the layer's boxes name, if any (`useLayerRoute`). */
  route: Route | undefined;
}

/** One diagram type's behaviour on the shared canvas; every field is optional and falls back to the plain diagram. */
export interface DiagramProfile {
  id: string;
  /** True when this profile owns `layer`; `members` is the layer's elements, or one element for per-box lookups. */
  matches: (layer: string, members: readonly CanvasElement[]) => boolean;
  /** The frame's bounds from the members' union; must stay pure, since callers memo on `boundsKey`. */
  frameBounds?: (base: UnionBounds, ctx: FrameCtx) => UnionBounds;
  /** A change key over everything `frameBounds` reads; when set, the frame recomputes only when it changes. */
  boundsKey?: (members: readonly CanvasElement[], layer: string) => string;
  frameClassName?: string;
  /** A control this type adds to its frame header, before the shared ones. */
  HeaderAction?: ComponentType<{ layer: string; members: CanvasElement[] }>;
  /** The arrowhead variant for an edge leaving this type's boxes; undefined keeps the default for `visual`. */
  edgeMarker?: (visual: EdgeVisual) => string | undefined;
  /** The text drawn on an edge leaving this type's boxes. */
  edgeLabel?: (edge: Pick<CanvasEdge, "label" | "kind">) => string;
  /** Whether `meta.lane` draws lane bands (default true). */
  laneBands?: boolean;
  /** Whether a shared order digit run draws a concurrency island (default true). */
  concurrencyIslands?: boolean;
  /** True skips the common box internals (the step-number chip). */
  plainBox?: boolean;
  /** True when the route legend lives in the diagram's own overlay and the route shows on open. */
  routeInOverlay?: boolean;
  /** Drawn once per layer on the canvas, inside the diagram frame. */
  Overlay?: ComponentType<{ layer: string; members: CanvasElement[]; sizes: ReadonlyMap<string, MeasuredBoxSize> }>;
  /** Deterministic layout for this type's new boxes; others go through ELK. */
  layout?: (doc: CanvasDoc, ids: readonly string[]) => { positions: Record<string, CanvasPosition>; sizes: Record<string, CanvasSize> };
}

/** The plain diagram: every shared behaviour on, no overlay, ELK layout. */
export const DEFAULT_PROFILE: DiagramProfile = { id: "default", matches: () => true };

/** Every non-default profile; the first match wins. */
export const DIAGRAM_PROFILES: readonly DiagramProfile[] = [SEQUENCE_PROFILE, WALKTHROUGH_PROFILE];

/** The profile that owns `layer` (given its members), else the default. */
export function profileFor(layer: string, members: readonly CanvasElement[]): DiagramProfile {
  return DIAGRAM_PROFILES.find((profile) => profile.matches(layer, members)) ?? DEFAULT_PROFILE;
}

/** The profile for one box, for per-element choices (layout, box internals, lanes, islands, edges). */
export function profileForElement(element: CanvasElement): DiagramProfile {
  return profileFor(element.layer, [element]);
}
