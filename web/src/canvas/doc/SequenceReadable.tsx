import type { CSSProperties, ReactNode } from "react";
import { flagMeta, stringMeta } from "./elementMeta";
import { SEQUENCE_LAYOUT } from "./autoLayout";
import { sequenceViewStore, type SequenceMode } from "./sequenceViewStore";
import { descriptionPopupStore } from "./descriptionPopupStore";
import {
  type SequenceMessage,
  type SequenceModel,
} from "./sequenceModel";

const BAND_W = 22;

export interface SequenceDrawingProps {
  layer: string;
  mode: SequenceMode;
  model: SequenceModel;
  /** Messages to leave out (focus mode: messages inside a collapsed phase). */
  isHidden?: (message: SequenceMessage) => boolean;
  /** Messages to fade (focus mode: not part of the focused participant). */
  isDim?: (message: SequenceMessage) => boolean;
  onHeadClick?: (ref: string) => void;
  focusRef?: string | null;
  /** The ▶ player's current order: later messages fade, this one is lit. */
  activeStep?: number | null;
  /** Extra layers drawn inside the diagram box, in diagram-local coordinates. */
  children?: (origin: { left: number; top: number }) => ReactNode;
}

/** The shared drawing of participants, lifelines, phase bands, frames, notes and numbered messages. */
export function SequenceDrawing({
  layer,
  mode,
  model,
  isHidden,
  isDim,
  onHeadClick,
  focusRef,
  activeStep,
  children,
}: SequenceDrawingProps) {
  const { participants, messages, phases, frames, notes } = model;
  const { left, top, right, bottom } = model.bounds;
  const shown = messages.filter((m) => !isHidden?.(m));
  const span = (from: number, to: number): [number, number] | null => {
    const ys = shown.filter((m) => m.order >= from && m.order <= to).map((m) => m.element.position.y);
    return ys.length ? [Math.min(...ys) - 24, Math.max(...ys) + 24] : null;
  };

  return (
    <div
      className={`sequence-diagram sequence-diagram--${mode}`}
      data-testid="sequence-diagram"
      data-layer={layer}
      data-mode={mode}
      style={{
        position: "absolute",
        left,
        top,
        width: right - left,
        height: bottom - top,
        pointerEvents: "none",
      }}
    >
      {participants.map(({ element, ref, accent }) => {
        const hw = (element.size?.w ?? SEQUENCE_LAYOUT.headW) / 2;
        const hh = (element.size?.h ?? SEQUENCE_LAYOUT.headH) / 2;
        const kind = stringMeta(element, "kind");
        return (
          <div
            key={element.id}
            className={`sequence-participant${focusRef === ref ? " sequence-participant--focused" : ""}`}
            data-testid="sequence-participant"
            style={
              {
                left: element.position.x - hw - left,
                top: element.position.y - hh - top,
                width: hw * 2,
                height: hh * 2,
                "--seq-accent-rgb": accent,
              } as CSSProperties
            }
          >
            <div
              className="sequence-participant-lane"
              style={{ top: hh, height: bottom - element.position.y - hh }}
            />
            <div
              className="sequence-participant-head"
              data-node-id={element.node_id ?? undefined}
              style={onHeadClick ? { pointerEvents: "auto", cursor: "pointer" } : undefined}
              onClick={onHeadClick ? () => onHeadClick(ref) : undefined}
            >
              <span className="sequence-participant-name">{element.label}</span>
              {kind && <span className="sequence-participant-kind">{kind}</span>}
            </div>
          </div>
        );
      })}

      {mode === "readable" &&
        phases.map((phase) => {
          const range = span(phase.from_order, phase.to_order);
          if (!range) return null;
          return (
            <div
              key={phase.id}
              className={`sequence-phase-band sequence-phase-band--${phase.kind}`}
              data-testid="sequence-phase-band"
              style={{ left: 0, top: range[0] - top, height: range[1] - range[0], width: BAND_W }}
            >
              <span className="sequence-phase-band-label">{phase.name}</span>
            </div>
          );
        })}

      {frames.map((frame, index) => {
        const range = span(frame.from_order, frame.to_order);
        if (!range) return null;
        return (
          <div
            key={`frame-${index}`}
            className={`sequence-frame sequence-frame--${frame.kind}`}
            data-testid="sequence-frame"
            style={{ left: BAND_W, right: 0, top: range[0] - top, height: range[1] - range[0] }}
          >
            <span className="sequence-frame-tag">{`${frame.kind} ${frame.label}`.trim()}</span>
          </div>
        );
      })}

      {shown.map((message) => (
        <MessageArrow
          key={message.element.id}
          message={message}
          left={left}
          top={top}
          dim={(isDim?.(message) ?? false) || (activeStep != null && message.order > activeStep)}
          active={activeStep != null && message.order === activeStep}
        />
      ))}

      {notes.map((note, index) => {
        const y = span(note.order, note.order)?.[0];
        if (y === undefined) return null;
        return (
          <div
            key={`note-${index}`}
            className="sequence-note"
            data-testid="sequence-note"
            style={{ right: 0, top: y - top + 36 }}
          >
            {note.text}
          </div>
        );
      })}

      {children?.({ left, top })}
    </div>
  );
}

function MessageArrow({
  message,
  left,
  top,
  dim,
  active,
}: {
  message: SequenceMessage;
  left: number;
  top: number;
  dim: boolean;
  active: boolean;
}) {
  const { element, fromCol, toCol, accent, order } = message;
  const isReturn = flagMeta(element, "return");
  const kind = stringMeta(element, "kind");
  const arrowClass = [
    "sequence-message",
    isReturn ? "sequence-message--return" : "",
    flagMeta(element, "async") ? "sequence-message--async" : "",
    flagMeta(element, "hero") ? "sequence-message--hero" : "",
    kind === "ai" ? "sequence-message--ai" : "",
    kind === "event" ? "sequence-message--event" : "",
    dim ? "sequence-message--dim" : "",
    active ? "sequence-message--active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const spanPx = Math.abs(toCol.position.x - fromCol.position.x);
  const style = {
    left: Math.min(fromCol.position.x, toCol.position.x) - left,
    top: element.position.y - top - 10,
    width: spanPx,
    "--seq-accent-rgb": accent,
  } as CSSProperties;

  return (
    <div
      className={arrowClass}
      data-testid="sequence-message"
      style={style}
      onClick={() =>
        descriptionPopupStore.open(
          element.label || "Message",
          element.description || `Message ${element.label || element.id}`,
        )
      }
    >
      <span className="sequence-message-label" style={{ maxWidth: Math.max(spanPx - 8, 40) }}>
        {order > 0 && <span className="sequence-message-num">{`${order} · `}</span>}
        {element.label}
      </span>
      <span
        className="sequence-message-line"
        style={isReturn ? { transform: "scaleX(-1)" } : undefined}
      />
    </div>
  );
}

export function SequenceReadable({ layer, model }: { layer: string; model: SequenceModel }) {
  return (
    <SequenceDrawing
      layer={layer}
      mode="readable"
      model={model}
      activeStep={sequenceViewStore.getStep(layer)}
    />
  );
}
