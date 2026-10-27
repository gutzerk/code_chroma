import type { CanvasElement } from "../../state/types";

export const ROUTE_KINDS = ["trigger", "decide", "ai", "check", "data", "failure"] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

export interface RouteChild {
  id: string;
  label: string;
  nodeId?: string;
  line: number;
}

export interface RouteStep {
  id: string;
  order: number;
  lane?: string;
  title: string;
  kind: RouteKind;
  nodeIds: string[];
  children: RouteChild[];
}

export interface Route {
  id: string;
  title: string;
  summary: string;
  steps: RouteStep[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

function childOf(raw: unknown): RouteChild | undefined {
  if (!isRecord(raw)) return undefined;
  const label = text(raw.label);
  const line = typeof raw.line === "number" && raw.line > 0 ? raw.line : undefined;
  if (!label || line === undefined) return undefined;
  return { id: text(raw.id) ?? label, label, nodeId: text(raw.node_id), line };
}

function stepOf(raw: unknown): RouteStep | undefined {
  if (!isRecord(raw)) return undefined;
  const id = text(raw.id);
  if (!id) return undefined;
  const kind = ROUTE_KINDS.find((k) => k === raw.kind) ?? "decide";
  const nodeIds = Array.isArray(raw.node_ids) ? raw.node_ids.filter((n): n is string => typeof n === "string") : [];
  const children = Array.isArray(raw.children) ? raw.children.map(childOf).filter((c): c is RouteChild => !!c) : [];
  return {
    id,
    order: typeof raw.order === "number" ? raw.order : 0,
    lane: text(raw.lane),
    title: text(raw.title) ?? id,
    kind,
    nodeIds,
    children,
  };
}

const stepCache = new WeakMap<object, RouteStep | undefined>();
const routeCache = new WeakMap<object, Route | undefined>();

/** Parses a raw meta object once; the same object is read by every box and every render. */
function cached<T>(cache: WeakMap<object, T | undefined>, raw: unknown, parse: (raw: unknown) => T | undefined): T | undefined {
  if (!isRecord(raw)) return parse(raw);
  if (!cache.has(raw)) cache.set(raw, parse(raw));
  return cache.get(raw);
}

/** The step a bridge stamped on this box (`meta.route_step`), or undefined for a box with no route step. */
export function routeStepOf(element: CanvasElement): RouteStep | undefined {
  return cached(stepCache, element.meta?.route_step, stepOf);
}

/** The route held by an element's own `meta.route`: a carrier element, or a pre-carrier document's box. */
export function routeOf(element: CanvasElement): Route | undefined {
  return cached(routeCache, element.meta?.route, parseRoute);
}

/** The route a box belongs to: its layer's carrier by `meta.route_id`, else the legacy `meta.route` on the box. */
export function routeFor(element: CanvasElement, carriers: readonly CanvasElement[]): Route | undefined {
  const id = element.meta?.route_id;
  const carrier = typeof id === "string" ? carriers.find((c) => c.meta?.route_id === id && c.layer === element.layer) : undefined;
  return (carrier && routeOf(carrier)) ?? routeOf(element);
}

function parseRoute(raw: unknown): Route | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) return undefined;
  const steps = raw.steps.map(stepOf).filter((s): s is RouteStep => !!s);
  return { id: text(raw.id) ?? "route", title: text(raw.title) ?? "Route", summary: text(raw.summary) ?? "", steps };
}
