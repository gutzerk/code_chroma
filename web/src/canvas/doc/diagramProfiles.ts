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
  /** The frame's bounds grown from the members' union, or null to keep the union; must stay pure, since callers memo on `boundsKey`. */
  frameBounds?: (base: UnionBounds, ctx: FrameCtx) => UnionBounds | null;
  /** A change key over everything `frameBounds` reads; when set, the frame recomputes only when it changes. */
  boundsKey?: (members: readonly CanvasElement[], layer: string) => string;
  frameClassName?: string;
  /** A control this type adds to its frame header, before the shared ones. */
  HeaderAction?: ComponentType<{ layer: string; members: CanvasElement[] }>;
  /** The arrowhead variant for an edge leaving this type's boxes; undefined keeps the default for `visual`. */
  edgeMarker?: (visual: EdgeVisual) => string | undefined;
  /** The text drawn on an edge leaving this type's boxes. */
  edgeLabel?: (edge: Pick<CanvasEdge, "label" | "kind">) => string;
  /** True skips the lane bands `meta.lane` would draw (a `Board` layer never gets them). */
  hideLaneBands?: boolean;
  /** Drawn once per layer inside the diagram frame; it holds the route legend, so the frame header drops it and the route shows on open. */
  Overlay?: ComponentType<{ layer: string; members: CanvasElement[]; sizes: ReadonlyMap<string, MeasuredBoxSize> }>;
  /** Draws the whole layer as one component instead of boxes (a sequence board); no lanes, islands or box chrome apply. */
  Board?: ComponentType<{ layer: string; elements: CanvasElement[] }>;
  /** The layer's elements at display-only geometry (expanded steps); never written to the doc. */
  viewElements?: (doc: CanvasDoc, ids: readonly string[], layer: string) => CanvasElement[];
  /** Change signal for `viewElements`: a store subscription and its version. */
  viewStore?: { subscribe: (listener: () => void) => () => void; getVersion: () => number };
  /** Deterministic layout for this type's new boxes; others go through ELK. */
  layout?: (doc: CanvasDoc, ids: readonly string[]) => { positions: Record<string, CanvasPosition>; sizes: Record<string, CanvasSize> };
}

/** The plain diagram: every shared behaviour on, no overlay, ELK layout. */
export const DEFAULT_PROFILE: DiagramProfile = { id: "default", matches: () => true };

let registry: readonly DiagramProfile[] | undefined;

/** Every non-default profile, first match wins; built on first use, since a profile's component can import back into this module. */
export function diagramProfiles(): readonly DiagramProfile[] {
  return (registry ??= [SEQUENCE_PROFILE, WALKTHROUGH_PROFILE]);
}

/** The profile that owns `layer` (given its members), else the default. */
export function profileFor(layer: string, members: readonly CanvasElement[]): DiagramProfile {
  return diagramProfiles().find((profile) => profile.matches(layer, members)) ?? DEFAULT_PROFILE;
}

/** The profile for one box, for per-element choices (layout, lanes, edges, boards). */
export function profileForElement(element: CanvasElement): DiagramProfile {
  return profileFor(element.layer, [element]);
}

/** A profile known to define `K`. */
export type ProfileWith<K extends keyof DiagramProfile> = DiagramProfile & Required<Pick<DiagramProfile, K>>;

/** Each layer's element ids whose profile defines `key`, with that profile. */
export function layersWithProfile<K extends keyof DiagramProfile>(
  elements: Iterable<CanvasElement>,
  key: K,
): Map<string, { profile: ProfileWith<K>; ids: string[] }> {
  const map = new Map<string, { profile: ProfileWith<K>; ids: string[] }>();
  for (const element of elements) {
    const profile = profileForElement(element);
    if (!hasField(profile, key)) continue;
    const entry = map.get(element.layer);
    if (entry) entry.ids.push(element.id);
    else map.set(element.layer, { profile, ids: [element.id] });
  }
  return map;
}

function hasField<K extends keyof DiagramProfile>(profile: DiagramProfile, key: K): profile is ProfileWith<K> {
  return profile[key] !== undefined;
}

/** Subscribes to every profile's view store, so one `useSyncExternalStore` covers them all. */
export function subscribeProfileViews(listener: () => void): () => void {
  const unsubscribes = diagramProfiles().flatMap((profile) => (profile.viewStore ? [profile.viewStore.subscribe(listener)] : []));
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

/** The profiles' view versions joined into one snapshot; changes when any of them does. */
export function profileViewsVersion(): string {
  return diagramProfiles().map((profile) => profile.viewStore?.getVersion() ?? 0).join(":");
}
