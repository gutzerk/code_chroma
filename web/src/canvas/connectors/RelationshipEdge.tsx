import type { CSSProperties } from "react";
import { hoveredEdgeStore, useIsActiveEdge, useIsEdgeHovering } from "../../state/hoveredEdgeStore";
import { EdgeLabel } from "./EdgeLabel";
import { authoredStyle } from "../authoredStyle";
import type { ImpactChangeStatus } from "../../state/types";

export interface RelationshipEdgeProps {
  /** Stable identity of this arrow — what the hover store records as active. */
  edgeKey: string;
  d: string;
  label: string;
  /** Type of call/transport (`call`, `https`, `mcp`, ...) — rendered as a second line under the
   * `label` divider; omitted renders a single-line label exactly as before. */
  transport?: string;
  labelX: number;
  labelY: number;
  /** `id` of the `<marker>` this renderer defines for its arrowheads. */
  markerId: string;
  /** Canvas node ids the arrow lands on, so the blocks can accent with it (null when unresolved). */
  fromNodeId: string | null;
  toNodeId: string | null;
  /** BEM suffix added to the stroke and caption classes — "--internal" for the quieter overlay.
   * Space-separated suffixes each produce their own class, so a caller can stack an overlay variant
   * and a per-kind colour ("--pattern --kind-uses") without them fusing into one bogus class. */
  variantSuffix?: string;
  /** Set by the change review: an arrow the diff added (dashed) or removed (grey ghost). */
  changeStatus?: ImpactChangeStatus;
  /** Set by an Impact diagram's own authored `relations[].hero` (pr-lens-style emphasis): the 1-2
   * relations the drawing skill judged as best explaining this PR, rendered bolder than the rest.
   * No other diagram type authors this field today. */
  isHero?: boolean;
  /** Optional authored inline style — an edge only meaningfully carries `color`, surfaced as the
   * inheritable `--edge-color` custom property the base stroke/label rules read; see `authoredStyle.ts`. */
  style?: Record<string, string> | null;
  /** `file:line` of the edge's caller (provenance) — when set, the label becomes clickable and
   * invokes `onOpenOrigin` to open that code location. */
  origin?: string;
  /** Opens the code at `origin` (called from a label click); a no-op when `origin` is unset. */
  onOpenOrigin?: (origin: string) => void;
  testId: string;
}

/**
 * One relationship arrow — its stroke, its caption, and the wide transparent hit-stroke that makes it
 * hoverable. Shared by both renderers (C1View's dagre layer and C1InternalConnections' DOM-measured
 * overlay) so an arrow behaves the same however it was laid out: hovering it marks it active and
 * marks every other arrow on the canvas dimmed, in both layers at once.
 *
 * 🔴 The hit-stroke exists because the visible stroke is unhoverable: it's 1–1.5px wide inside an
 * overlay whose root is `pointer-events: none` (it lies over the blocks and must never eat their
 * clicks). A separate transparent path re-enables `pointer-events` on itself alone — the one element
 * of the overlay that is a hit target — and widens the target to something a pointer can actually
 * land on. It deliberately stays out of PAN_IGNORE_SELECTOR: a drag that starts on an arrow should
 * still pan the canvas, exactly as a drag starting on empty space does.
 */
export function RelationshipEdge({
  edgeKey,
  d,
  label,
  transport,
  labelX,
  labelY,
  markerId,
  fromNodeId,
  toNodeId,
  variantSuffix = "",
  changeStatus,
  isHero = false,
  style,
  origin,
  onOpenOrigin,
  testId,
}: RelationshipEdgeProps) {
  const isActive = useIsActiveEdge(edgeKey, fromNodeId, toNodeId);
  const isHovering = useIsEdgeHovering();
  const stateClass = isActive
    ? " c1-relationship--active"
    : isHovering
      ? " c1-relationship--dimmed"
      : "";
  const suffixes = variantSuffix.split(/\s+/).filter(Boolean);
  if (isHero) suffixes.push("--hero");
  const variant = (base: string) =>
    [base, ...suffixes.map((suffix) => `${base}${suffix}`)].join(" ");
  // An authored `color` is surfaced as the inheritable custom property `--edge-color` the base
  // `.c1-relationship-path`/`-label` rules read via `var(--edge-color, <default>)` -- same
  // inline-style, no-flag idiom the nodes use. Only a real `color` (not a background/border no-op)
  // sets it, so an unstyled edge keeps the defaults. (CSS custom properties inherit down to the SVG
  // paths; `color` itself doesn't reach their stroke/fill.)
  const authoredColor = authoredStyle(style)?.color;
  const edgeStyle: CSSProperties | undefined = authoredColor
    ? ({ "--edge-color": authoredColor } as CSSProperties)
    : undefined;

  return (
    <g
      className={`${changeStatus ? `c1-relationship--${changeStatus}` : ""}${stateClass}`.trim() || undefined}
      data-testid={testId}
      data-change-status={changeStatus}
      data-hero={isHero || undefined}
      data-edge-key={edgeKey}
      data-edge-active={isActive || undefined}
      style={edgeStyle}
    >
      <path className="c1-relationship-casing" d={d} />
      <path
        className={variant("c1-relationship-path")}
        d={d}
        markerEnd={`url(#${markerId})`}
      />
      <path
        className="c1-relationship-hit"
        data-testid="c1-relationship-hit"
        d={d}
        onPointerEnter={() => hoveredEdgeStore.setHovered({ key: edgeKey, fromNodeId, toNodeId })}
        onPointerLeave={() => hoveredEdgeStore.clear(edgeKey)}
      />
      <EdgeLabel
        className={variant("c1-relationship-label")}
        x={labelX}
        y={labelY}
        text={label}
        transport={transport}
        origin={origin}
        onOpenOrigin={onOpenOrigin}
      />
    </g>
  );
}
