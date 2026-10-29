import { useMemo, useSyncExternalStore } from "react";
import type { CanvasElement } from "../../state/types";
import { boardOrigin, buildSequenceBoard, type BoardArrow } from "./sequenceBoard";
import { sequenceViewStore } from "./sequenceViewStore";
import { SequenceStep } from "./SequenceStep";

/**
 * Renders one whole `sequence` layer as the A4 "glance + expand in place" board.
 *
 * One swimlane per participant, one column per step (message, in `order`), phase pills on top, a
 * failure lane for `error` steps and the legend below. Clicking a step expands it in place into the
 * functions of its linked code; the expanded ids live in `sequenceViewStore` (display only), and the
 * view stage (`viewSequenceElements`) has already laid the elements out for them.
 */
export interface SequenceDiagramProps {
  layer: string;
  elements: CanvasElement[];
}

/** Phase kind → the tone its pill borrows. */
const PILL_TONE: Record<string, string> = {
  request: "route",
  prepare: "logic",
  ai: "ai",
  deliver: "data",
  check: "check",
};

/** Marker ids are document-wide, so each layer gets its own prefix. */
const markerPrefix = (layer: string): string => `seq-${layer.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export function SequenceDiagram({ layer, elements }: SequenceDiagramProps) {
  useSyncExternalStore(sequenceViewStore.subscribe, sequenceViewStore.getVersion);
  const { expanded } = sequenceViewStore.get(layer);
  const expandedKey = expanded.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- expandedKey is the change signal for `expanded`
  const board = useMemo(() => buildSequenceBoard(elements, expanded), [elements, expandedKey]);
  const origin = boardOrigin(board);
  if (!origin) return null;
  const activeStep = sequenceViewStore.getStep(layer);
  const prefix = markerPrefix(layer);
  const marker = (arrow: BoardArrow) => `url(#${prefix}-${arrow.kind})`;

  return (
    <div
      className="sequence-diagram"
      data-testid="sequence-diagram"
      data-layer={layer}
      style={{ position: "absolute", left: origin.x, top: origin.y, width: board.width, height: board.height }}
    >
      {board.pills.map((pill) => (
        <div
          key={pill.id}
          className={`seq-pill seq-tone--${PILL_TONE[pill.kind] ?? "plain"}${pill.w > 140 ? "" : " seq-pill--solo"}`}
          data-testid="sequence-phase-pill"
          style={{ left: pill.x, width: pill.w }}
        >
          <span className="seq-pill-line" />
          <span className="seq-pill-label">{pill.label}</span>
          <span className="seq-pill-line" />
        </div>
      ))}

      {board.lanes.map((lane) => (
        <div key={lane.id} className={`seq-lane seq-lane--${lane.tone}`} data-testid="sequence-lane" style={{ top: lane.rect.y, height: lane.rect.h }}>
          <span className="seq-lane-label">{lane.label}</span>
        </div>
      ))}

      {board.frames.map((frame) => (
        <div
          key={frame.id}
          className="seq-frame"
          data-testid="sequence-frame"
          style={{ left: frame.rect.x, top: frame.rect.y, width: frame.rect.w, height: frame.rect.h }}
        >
          <span className="seq-frame-tag">{frame.label}</span>
        </div>
      ))}

      <svg className="seq-arrows" width={board.width} height={board.lanesBottom} aria-hidden="true">
        <defs>
          {(["main", "side", "fail", "inner"] as const).map((kind) => (
            <marker
              key={kind}
              id={`${prefix}-${kind}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth={kind === "inner" ? 6 : 7}
              markerHeight={kind === "inner" ? 6 : 7}
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className={`seq-marker seq-marker--${kind}`} />
            </marker>
          ))}
        </defs>
        {board.arrows.map((arrow) => (
          <path
            key={arrow.id}
            d={arrow.d}
            className={`seq-arrow seq-arrow--${arrow.kind}${activeStep !== null && arrow.order > activeStep ? " seq-arrow--dim" : ""}`}
            data-testid="sequence-arrow"
            data-kind={arrow.kind}
            markerEnd={marker(arrow)}
          />
        ))}
      </svg>

      {board.steps.map((step) => (
        <SequenceStep
          key={step.id}
          layer={layer}
          step={step}
          markerPrefix={prefix}
          dim={activeStep !== null && step.message.order > activeStep}
          active={activeStep !== null && step.message.order === activeStep}
        />
      ))}

      <SequenceLegend top={board.lanesBottom + 20} />
    </div>
  );
}

const TONE_ITEMS: ReadonlyArray<readonly [string, string]> = [
  ["actor", "Actor / trigger"],
  ["route", "Entry route"],
  ["logic", "Logic, no AI"],
  ["ai", "AI step"],
  ["check", "Check"],
  ["data", "Data written"],
  ["fail", "Failure"],
];

const LINE_ITEMS: ReadonlyArray<readonly [string, string]> = [
  ["main", "Main path"],
  ["inner", "Call inside a step"],
  ["side", "Side effect"],
  ["fail", "Failure branch"],
];

/** The legend row: step order, expand/open glyphs, the step tones and the four arrow kinds. */
function SequenceLegend({ top }: { top: number }) {
  return (
    <div className="seq-legend" data-testid="sequence-legend" style={{ top }}>
      <span className="seq-legend-title">LEGEND</span>
      <span className="seq-legend-item">
        <span className="seq-badge seq-badge--legend">01</span>Step order
      </span>
      <span className="seq-legend-item">
        <span className="seq-legend-glyph">▸</span>Expand into its functions, in place
      </span>
      <span className="seq-legend-item">
        <span className="seq-legend-glyph">↗</span>Open source
      </span>
      <span className="seq-legend-divider" />
      {TONE_ITEMS.map(([tone, label]) => (
        <span key={tone} className="seq-legend-item">
          <span className={`seq-legend-swatch seq-tone--${tone}`} />
          {label}
        </span>
      ))}
      <span className="seq-legend-divider" />
      {LINE_ITEMS.map(([kind, label]) => (
        <span key={kind} className="seq-legend-item">
          <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
            <path d="M0,4 H26" className={`seq-arrow seq-arrow--${kind}`} />
          </svg>
          {label}
        </span>
      ))}
    </div>
  );
}
