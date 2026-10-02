import { useState } from "react";
import {
  useCodeVisibleNodeIdsByOrder,
  useExpandedNodeIdsByOrder,
} from "../state/expansionState";
import { useCanvasLayoutVersion } from "../state/canvasLayoutStore";
import { useAllChangeCards, useChangeCardGeometryVersion } from "../state/changeCardStore";
import {
  BLOCK_HEADER_SELECTOR,
  BLOCK_ROW_SELECTOR,
  borderSegment,
  countLabel,
  getToLocal,
  useOverlaySvgRef,
} from "./canvasOverlay";
import type { PlanStatus } from "./planStatus";

interface PlanConnector {
  key: string;
  d: string;
  frame: { x: number; y: number; width: number; height: number };
  /** Diff-style bucket of the block's cards (written by CardPanel as data-<prefix>-status), driving
   * the green/blue/red frame + line accent; defaults to "change" if the attribute is missing. */
  status: PlanStatus;
}

// The change layer sits further out, so a future second layer's frame could nest outside it
// instead of drawing on top of it.
const CHANGE_FRAME_PADDING = 8;

/** Which card layer an overlay instance draws for. Kept as its own type (not inlined into
 * ConnectionsOverlay) so a future second layer just adds a sibling OverlayLayer const. */
interface OverlayLayer {
  /** Attribute selector the panels of this layer stamp themselves with. */
  selector: string;
  /** The camelCased dataset key holding the node id, e.g. "changeNodeId". */
  nodeIdKey: string;
  /** The camelCased dataset key holding the status, e.g. "changeStatus". */
  statusKey: string;
  /** Extra class on the <svg>, so the layers are distinguishable in CSS and in the DOM. */
  extraClass: string;
  testId: string;
  framePadding: number;
  /** Singular noun for the aria-label, e.g. "plan step" — pluralized with a trailing "s". */
  noun: string;
}

const CHANGE_LAYER: OverlayLayer = {
  selector: "[data-change-node-id]",
  nodeIdKey: "changeNodeId",
  statusKey: "changeStatus",
  extraClass: "change-connections-overlay",
  testId: "change-connections-overlay",
  framePadding: CHANGE_FRAME_PADDING,
  noun: "change card",
};

interface ConnectionsOverlayProps {
  layer: OverlayLayer;
  /** This layer's cards — only used as a recompute trigger, never read. */
  cards: unknown[];
  geometryVersion: number;
}

/** For every open card panel of one layer, draws a frame around its target block and a line from the
 * panel to that frame's edge — so an explanation stays visually tied to the code it describes even
 * after the user drags it across the canvas. Reuses ConnectionsOverlay's trick: the SVG lives inside
 * .canvas-content, so getScreenCTM() bakes in pan/zoom and the frames/lines stay glued with no
 * viewport bookkeeping. Unlike ConnectionsOverlay it also recomputes on a geometry bump, since
 * drag/resize move a panel via a local transform the expand/collapse triggers never see. */
function ConnectionsOverlay({ layer, cards, geometryVersion }: ConnectionsOverlayProps) {
  const expandedNodeIds = useExpandedNodeIdsByOrder();
  const codeVisibleNodeIds = useCodeVisibleNodeIdsByOrder();
  const layoutVersion = useCanvasLayoutVersion();
  const [connectors, setConnectors] = useState<PlanConnector[]>([]);

  const svgRef = useOverlaySvgRef(() => {
    const toLocal = getToLocal(svgRef.current);
    if (!toLocal) return;

    const next: PlanConnector[] = [];
    const panels = document.querySelectorAll<HTMLElement>(layer.selector);
    for (const panel of panels) {
      const nodeId = panel.dataset[layer.nodeIdKey];
      if (!nodeId) continue;
      const status = (panel.dataset[layer.statusKey] as PlanStatus) ?? "change";
      // The panel's own row holds its block header — children live in a separate .*-children
      // container outside the row, so this can't accidentally grab a descendant's header. The
      // header excludes the flown-out panel, so its box marks the block's own footprint.
      const row = panel.closest(BLOCK_ROW_SELECTOR);
      const header = row?.querySelector<HTMLElement>(BLOCK_HEADER_SELECTOR);
      if (!header) continue;

      const pr = panel.getBoundingClientRect();
      const hr = header.getBoundingClientRect();

      // Frame: the block's own box, padded out so the line meets a frame around the block rather
      // than the text inside it.
      const frameBox = {
        left: hr.left - layer.framePadding,
        top: hr.top - layer.framePadding,
        right: hr.right + layer.framePadding,
        bottom: hr.bottom + layer.framePadding,
      };

      // Border-to-border, so the line meets the frame's edge whatever direction the panel sits in.
      const segment = borderSegment(pr, frameBox);
      const from = toLocal(segment.from.x, segment.from.y);
      const to = toLocal(segment.to.x, segment.to.y);
      const tl = toLocal(frameBox.left, frameBox.top);
      const br = toLocal(frameBox.right, frameBox.bottom);
      next.push({
        key: nodeId,
        d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
        frame: { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y },
        status,
      });
    }
    setConnectors(next);
    // Panels mount async after setSteps + reveal — useOverlaySvgRef's extra next-frame pass
    // catches layout settle.
  }, [cards, expandedNodeIds, codeVisibleNodeIds, geometryVersion, layoutVersion]);

  const label = countLabel(connectors.length, layer.noun);

  return (
    <svg
      ref={svgRef}
      className={`plan-connections-overlay ${layer.extraClass}`.trim()}
      data-testid={layer.testId}
      role="img"
      aria-label={label}
    >
      {connectors.map(({ key, d, frame, status }) => (
        <g key={key}>
          <rect
            className={`plan-connection-frame plan-connection-frame--${status}`}
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            rx={8}
          />
          <path className={`plan-connection-path plan-connection-path--${status}`} d={d} />
        </g>
      ))}
    </svg>
  );
}

/** The change-card layer's connectors. */
export function ChangeConnectionsOverlay() {
  const cards = useAllChangeCards();
  const geometryVersion = useChangeCardGeometryVersion();
  return <ConnectionsOverlay layer={CHANGE_LAYER} cards={cards} geometryVersion={geometryVersion} />;
}
