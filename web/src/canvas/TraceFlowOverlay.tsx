import { useState } from "react";
import { expansionStore, useExpandedNodeIdsByOrder } from "../state/expansionState";
import { useCanvasLayoutVersion } from "../state/canvasLayoutStore";
import { useTraceState } from "../state/traceStore";
import {
  BLOCK_HEADER_SELECTOR,
  borderSegment,
  countLabel,
  getToLocal,
  useOverlaySvgRef,
  type ScreenBox,
} from "./canvasOverlay";
import { ArrowMarkerDefs } from "./connectors/ArrowMarkerDefs";
import type { TraceFrame } from "../state/types";

interface NodeMark {
  key: string;
  frame: { x: number; y: number; width: number; height: number };
  active: boolean;
  error: boolean;
}

interface EdgeMark {
  key: string;
  d: string;
  active: boolean;
  error: boolean;
}

// How many prior steps trail behind the current one as fading marks.
const TRAIL = 5;
const FRAME_PADDING = 4;

// Module-level so the <defs> block stays stable across renders (see ArrowMarkerDefs). The error
// head needs its own marker: a marker's contents are never a DOM sibling of the edge <path>
// referencing it, so it can't be recolored through a sibling selector.
const TRACE_ARROW_MARKERS = [
  { id: "trace-arrow", className: "trace-arrow-head" },
  { id: "trace-arrow-error", className: "trace-arrow-head trace-arrow-head--error" },
];

function nodeBox(nodeId: string): ScreenBox | null {
  const el = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`);
  if (!el) return null;
  const header = el.querySelector<HTMLElement>(BLOCK_HEADER_SELECTOR) ?? el;
  const r = header.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function isErrorFrame(frame: TraceFrame): boolean {
  return frame.event === "raise" || frame.event === "unwind" || frame.error != null;
}

/** Animates the recorded call path over the hierarchy: for the current step it draws an edge from
 * the caller's visible block to the callee's and pulses the active node; recent steps trail behind,
 * fading. Error steps (raise/unwind) render red. Endpoints snap to each node's nearest VISIBLE
 * ancestor (expansionStore) so a collapsed target routes flow block-to-block, and an expanded one
 * routes function-to-function — the same trick as ConnectionsOverlay. Like ChangeConnectionsOverlay
 * the SVG lives inside .canvas-content, so getScreenCTM() bakes in pan/zoom with no viewport math. */
export function TraceFlowOverlay() {
  const snapshot = useTraceState();
  const expandedNodeIds = useExpandedNodeIdsByOrder();
  const layoutVersion = useCanvasLayoutVersion();
  const [nodes, setNodes] = useState<NodeMark[]>([]);
  const [edges, setEdges] = useState<EdgeMark[]>([]);

  const stepIndex = snapshot.stepIndex;
  const steps = snapshot.trace?.steps;

  const svgRef = useOverlaySvgRef(() => {
    if (!svgRef.current || !steps || steps.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const toLocal = getToLocal(svgRef.current);
    if (!toLocal) return;

    const nextNodes: NodeMark[] = [];
    const nextEdges: EdgeMark[] = [];
    const seenNodes = new Set<string>();
    const from = Math.max(0, stepIndex - TRAIL);

    for (let i = from; i <= stepIndex && i < steps.length; i++) {
      const step = steps[i];
      if (!step.node_id) continue;
      const active = i === stepIndex;
      const error = isErrorFrame(step);
      const calleeId = expansionStore.getNearestVisibleAncestor(step.node_id);
      if (!calleeId) continue;
      const calleeBox = nodeBox(calleeId);
      if (!calleeBox) continue;

      if (!seenNodes.has(calleeId) || active) {
        seenNodes.add(calleeId);
        const tl = toLocal(calleeBox.left - FRAME_PADDING, calleeBox.top - FRAME_PADDING);
        const br = toLocal(calleeBox.right + FRAME_PADDING, calleeBox.bottom + FRAME_PADDING);
        nextNodes.push({
          key: `${i}:${calleeId}`,
          frame: { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y },
          active,
          error,
        });
      }

      const callerRaw = step.caller_node_id ?? null;
      const callerId = callerRaw ? expansionStore.getNearestVisibleAncestor(callerRaw) : null;
      if (!callerId || callerId === calleeId) continue;
      const callerBox = nodeBox(callerId);
      if (!callerBox) continue;

      const segment = borderSegment(callerBox, calleeBox);
      const a = toLocal(segment.from.x, segment.from.y);
      const b = toLocal(segment.to.x, segment.to.y);
      nextEdges.push({
        key: `${i}:${callerId}->${calleeId}`,
        d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
        active,
        error,
      });
    }
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [steps, stepIndex, expandedNodeIds, layoutVersion]);

  const label = countLabel(nodes.length, "trace step");

  return (
    <svg
      ref={svgRef}
      className="trace-flow-overlay"
      data-testid="trace-flow-overlay"
      role="img"
      aria-label={label}
    >
      <ArrowMarkerDefs markers={TRACE_ARROW_MARKERS} size={7} orient="auto-start-reverse" />
      {edges.map(({ key, d, active, error }) => (
        <path
          key={key}
          className={`trace-flow-edge${active ? " trace-flow-edge--active" : ""}${error ? " trace-flow-edge--error" : ""}`}
          d={d}
          markerEnd={error ? "url(#trace-arrow-error)" : "url(#trace-arrow)"}
        />
      ))}
      {nodes.map(({ key, frame, active, error }) => (
        <rect
          key={key}
          className={`trace-node-frame${active ? " trace-node-frame--active" : ""}${error ? " trace-node-frame--error" : ""}`}
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          rx={8}
        />
      ))}
    </svg>
  );
}
