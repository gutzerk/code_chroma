import { useEngineClient } from "../../engine-client/EngineClientContext";
import { inspectorStore } from "../inspectorStore";
import type { BoardStep } from "./sequenceBoard";
import { sequenceViewStore } from "./sequenceViewStore";
import { STEP_FUNCTION_SLOTS, useStepFunctions, type StepFunctions } from "./sequenceStepFunctions";

/** Function-card grid inside an expanded step, in the mockup's card-local pixels. */
const CARD = { x: 16, y: 52, w: 168, h: 44, colGap: 12, rowPitch: 64 } as const;

export interface SequenceStepProps {
  layer: string;
  step: BoardStep;
  markerPrefix: string;
  dim: boolean;
  active: boolean;
}

// The step whose toggle the user just pressed: its new button takes focus once mounted.
let pendingFocusId: string | null = null;

const focusIfPending = (id: string) => (node: HTMLButtonElement | null) => {
  if (!node || pendingFocusId !== id) return;
  pendingFocusId = null;
  node.focus({ preventScroll: true });
};

const fileName = (nodeId: string): string => nodeId.replace(/^[a-z]+::/, "").split("::")[0].split("/").pop() ?? nodeId;

/** One step: a glance box (or START/END pill, or failure box) that expands in place on click. */
export function SequenceStep({ layer, step, markerPrefix, dim, active }: SequenceStepProps) {
  const { message, rect, tone, shape, number, expanded } = step;
  const { element } = message;
  const toggle = () => {
    pendingFocusId = element.id;
    sequenceViewStore.toggleExpanded(layer, element.id);
  };
  const className = [
    "seq-step",
    `seq-tone--${tone}`,
    `seq-step--${shape}`,
    tone === "fail" ? "seq-step--failure" : "",
    expanded ? "seq-step--expanded" : "",
    dim ? "seq-step--dim" : "",
    active ? "seq-step--active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
  const tooltip = [message.fromCol.label, "→", message.toCol.label, element.description ? `· ${element.description}` : ""].join(" ").trim();

  if (tone === "fail") {
    return (
      <div className={className} data-testid="sequence-step" data-step-id={element.id} style={style} title={tooltip}>
        <span className="seq-step-name">{element.label}</span>
      </div>
    );
  }
  if (expanded) {
    return <ExpandedStep step={step} className={className} style={style} onToggle={toggle} caretRef={focusIfPending(element.id)} markerPrefix={markerPrefix} />;
  }

  const sourceId = message.fromCol.node_id;
  return (
    <div className={className} data-testid="sequence-step" data-step-id={element.id} title={tooltip} style={style} onClick={toggle}>
      <button
        type="button"
        className="seq-step-toggle"
        ref={focusIfPending(element.id)}
        aria-expanded={false}
        aria-label={`Expand ${element.label}`}
      />
      {shape === "step" ? (
        <span className="seq-step-top">
          <span className="seq-badge">{number}</span>
          {tone === "ai" && <span className="seq-ai-chip">AI</span>}
          <span className="seq-step-glyphs">
            ▸
            {sourceId && <SourceButton nodeId={sourceId} label={message.fromCol.label} elementId={message.fromCol.id} />}
          </span>
        </span>
      ) : (
        <span className="seq-step-kicker">{shape === "start" ? "START" : "END"}</span>
      )}
      <span className="seq-step-name">{element.label}</span>
    </div>
  );
}

function SourceButton({ nodeId, label, elementId, text = "↗" }: { nodeId: string; label: string; elementId: string; text?: string }) {
  return (
    <button
      type="button"
      className="seq-src"
      data-testid="sequence-step-src"
      aria-label={`Open source of ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        inspectorStore.open(nodeId, label, elementId);
      }}
    >
      {text}
    </button>
  );
}

/** The opened step: header, one line of who-calls-whom, and its linked code's functions. */
function ExpandedStep({
  step,
  className,
  style,
  onToggle,
  caretRef,
  markerPrefix,
}: {
  step: BoardStep;
  className: string;
  style: { left: number; top: number; width: number; height: number };
  onToggle: () => void;
  caretRef: (node: HTMLButtonElement | null) => void;
  markerPrefix: string;
}) {
  const client = useEngineClient();
  const { message, number, shape, tone, note } = step;
  const { element } = message;
  const sourceId = message.fromCol.node_id ?? null;
  const stepText = `${element.label} ${element.description}`;
  const fns = useStepFunctions(client, sourceId, stepText);
  const badge = shape === "step" ? number : shape === "start" ? "START" : "END";
  const subline = [`${message.fromCol.label} → ${message.toCol.label}`, element.description, note].filter(Boolean).join(" · ");
  return (
    <div className={className} data-testid="sequence-step" data-step-id={element.id} style={style}>
      <div className="seq-exp-head">
        <span className="seq-badge">{badge}</span>
        {tone === "ai" && <span className="seq-ai-chip">AI</span>}
        <span className="seq-exp-name">{element.label}</span>
        {sourceId && (
          <SourceButton nodeId={sourceId} label={message.fromCol.label} elementId={message.fromCol.id} text={`${fileName(sourceId)} ↗`} />
        )}
        <button
          type="button"
          className="seq-caret"
          ref={caretRef}
          aria-expanded
          aria-label={`Collapse ${element.label}`}
          data-testid="sequence-step-collapse"
          onClick={onToggle}
        >
          ▾
        </button>
      </div>
      <div className="seq-exp-sub" title={subline}>
        {subline}
      </div>
      <FunctionGrid fns={fns} markerPrefix={markerPrefix} sourceId={sourceId} fileLabel={message.fromCol.label} fileElementId={message.fromCol.id} />
    </div>
  );
}

const slotRect = (slot: number) => ({
  x: CARD.x + (slot % 2) * (CARD.w + CARD.colGap),
  y: CARD.y + Math.floor(slot / 2) * CARD.rowPitch,
});

/** Card-local path of one inner call: straight in a row or column, an elbow across both. */
function innerCallPath(from: number, to: number): string {
  const a = slotRect(from);
  const b = slotRect(to);
  if (a.y === b.y) {
    return b.x > a.x ? `M${a.x + CARD.w},${a.y + CARD.h / 2} H${b.x - 1}` : `M${a.x},${a.y + CARD.h / 2} H${b.x + CARD.w + 1}`;
  }
  const down = b.y > a.y;
  const startX = a.x === b.x ? a.x + CARD.w / 2 : a.x + (b.x < a.x ? 28 : CARD.w - 28);
  const startY = down ? a.y + CARD.h : a.y;
  const endY = down ? b.y - 1 : b.y + CARD.h + 1;
  if (a.x === b.x) return `M${startX},${startY} V${endY}`;
  const bendY = down ? startY + 10 : startY - 10;
  return `M${startX},${startY} V${bendY} H${b.x + CARD.w / 2} V${endY}`;
}

function FunctionGrid({
  fns,
  markerPrefix,
  sourceId,
  fileLabel,
  fileElementId,
}: {
  fns: StepFunctions;
  markerPrefix: string;
  sourceId: string | null;
  fileLabel: string;
  fileElementId: string;
}) {
  if (!sourceId) return <div className="seq-exp-empty">No linked code for this step.</div>;
  if (fns.status === "loading" || fns.status === "idle") return <div className="seq-exp-empty">Loading functions…</div>;
  if (fns.status === "error" || fns.functions.length === 0) return <div className="seq-exp-empty">No functions found in the linked code.</div>;
  const more = fns.total - fns.functions.length;
  const moreRect = slotRect(STEP_FUNCTION_SLOTS - 1);
  return (
    <>
      <svg className="seq-exp-calls" aria-hidden="true">
        {fns.calls.map(([from, to]) => (
          <path key={`${from}-${to}`} d={innerCallPath(from, to)} className="seq-arrow seq-arrow--inner" markerEnd={`url(#${markerPrefix}-inner)`} />
        ))}
      </svg>
      {fns.functions.map((fn, slot) => {
        const { x, y } = slotRect(slot);
        return (
          <button
            key={fn.nodeId}
            type="button"
            className="seq-fn"
            data-testid="sequence-step-function"
            style={{ left: x, top: y, width: CARD.w, height: CARD.h }}
            title={fn.params ? `${fn.name} — ${fn.params}` : fn.name}
            onClick={(event) => {
              event.stopPropagation();
              inspectorStore.open(fn.nodeId, fn.name);
            }}
          >
            <span className="seq-fn-name">{`${fn.name}()`}</span>
            <span className="seq-fn-desc">{fn.params ?? ""}</span>
          </button>
        );
      })}
      {more > 0 && sourceId && (
        <button
          type="button"
          className="seq-fn seq-fn--more"
          data-testid="sequence-step-more"
          style={{ left: moreRect.x, top: moreRect.y, width: CARD.w, height: CARD.h }}
          onClick={(event) => {
            event.stopPropagation();
            inspectorStore.open(sourceId, fileLabel, fileElementId);
          }}
        >
          {`+ ${more} more ▸`}
        </button>
      )}
    </>
  );
}
