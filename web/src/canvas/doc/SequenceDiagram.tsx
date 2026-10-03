import type { CSSProperties } from "react";
import type { CanvasElement } from "../../state/types";
import { flagMeta, rawMeta, stringMeta } from "./elementMeta";
import { groupColorIndex, GROUP_COLOR_COUNT } from "./groupColor";
import { descriptionPopupStore } from "./descriptionPopupStore";

/**
 * The one own-component that renders an entire `sequence`-layer (a UML-style sequence diagram).
 *
 * A sequence layer is a hard, non-user-draggable structure (lockedLayout in elementRules.ts): the
 * geometry lives on each element's OWN persisted `position` — written by autoLayout's `layoutSequence`
 * (participants in left-to-right columns, messages on their time-rows) — and this component draws
 * every participant/message AT that position. `DiagramFrame` reads the same positions to surround the
 * layer and to move every member together on a whole-diagram frame drag, so deriving the drawing from
 * the persisted positions keeps the frame and the blocks in lockstep by construction.
 *
 * `meta` supplies only what position can't: an element's `role` (participant vs message), which two
 * participant refs a message connects (`from`/`to`), its `order`, and the `return`/`async` flag that
 * shapes the arrow. Each participant's stable hue comes from hashing its name into the shared palette.
 *
 * Purely display: no drag/click of its own, mirroring GroupFrame. Clicking a message opens the
 * description popup (its `description` carries the request's detail); clicking through to a
 * participant's Inspector still works because each participant element is anchorable by `node_id`.
 */

interface Participant {
  element: CanvasElement;
}

interface Message {
  element: CanvasElement;
  fromCol: CanvasElement;
  toCol: CanvasElement;
  accent: string;
}

export interface SequenceDiagramProps {
  /** The layer's own elements (participants + messages) — its layer name, for a stable React key. */
  layer: string;
  elements: CanvasElement[];
}

export function SequenceDiagram({ layer, elements }: SequenceDiagramProps) {
  const participants: Participant[] = [];
  let messages: Message[] = [];
  const byRef = new Map<string, CanvasElement>();

  for (const element of elements) {
    if (stringMeta(element, "role") === "participant") {
      participants.push({ element });
      const ref = stringMeta(element, "recipe_key") ?? element.id;
      byRef.set(element.id, element);
      byRef.set(ref, element);
    }
  }

  const accentByRef = new Map<string, string>();
  for (const { element } of participants) {
    const ref = stringMeta(element, "recipe_key") ?? element.id;
    accentByRef.set(ref, sequenceAccentRef(ref));
  }

  messages = elements
    .map((element) => {
      if (stringMeta(element, "role") !== "message") return null;
      const fromRef = String(rawMeta(element, "from") ?? "");
      const toRef = String(rawMeta(element, "to") ?? "");
      const fromEl = byRef.get(fromRef);
      const toEl = byRef.get(toRef);
      if (!fromEl || !toEl) return null;
      return {
        element,
        fromCol: fromEl,
        toCol: toEl,
        accent: accentByRef.get(fromRef) ?? "160, 165, 175",
      };
    })
    .filter((m): m is Message => m !== null)
    .sort((a, b) => orderOf(a.element) - orderOf(b.element));

  // The container exactly encloses every element's persisted rect (position = center, size around
  // it — the same contract elementRect/unionBoundsOf use for DiagramFrame), so the diagram's own
  // bounding box and the frame are identical and nothing (lifeline, arrows) leaks past it. Each
  // child is drawn at position − origin, preserving absolute placement inside this frame.
  const allRects = elements.map((element) => {
    const w = element.size?.w ?? 180;
    const h = element.size?.h ?? 36;
    return {
      left: element.position.x - w / 2,
      top: element.position.y - h / 2,
      right: element.position.x + w / 2,
      bottom: element.position.y + h / 2,
    };
  });
  const left = Math.min(...allRects.map((r) => r.left));
  const top = Math.min(...allRects.map((r) => r.top));
  const right = Math.max(...allRects.map((r) => r.right));
  const bottom = Math.max(...allRects.map((r) => r.bottom));

  return (
    <div
      className="sequence-diagram"
      data-testid="sequence-diagram"
      data-layer={layer}
      style={{
        position: "absolute",
        left,
        top,
        width: right - left,
        height: bottom - top,
        pointerEvents: "none",
      }}
    >
      {/* Participant lifelines: a head capsule centered on its persisted position (frame treats
          position as center) + a dashed vertical line from just below the head down to the frame's
          bottom. */}
      {participants.map(({ element }) => {
        const hw = (element.size?.w ?? HEAD_W) / 2;
        const hh = (element.size?.h ?? HEAD_H) / 2;
        return (
          <div
            key={element.id}
            className="sequence-participant"
            data-testid="sequence-participant"
            style={
              {
                left: element.position.x - hw - left,
                top: element.position.y - hh - top,
                width: hw * 2,
                height: hh * 2,
                "--seq-accent-rgb": accentByRef.get(stringMeta(element, "recipe_key") ?? element.id),
              } as CSSProperties
            }
          >
            <div
              className="sequence-participant-lane"
              style={{ top: hh, height: bottom - element.position.y - hh }}
            />
            <div className="sequence-participant-head" data-node-id={element.node_id ?? undefined}>
              <span className="sequence-participant-name">{element.label}</span>
            </div>
          </div>
        );
      })}

      {/* Messages: one horizontal arrow per row, at its own persisted center y, from the sender's
          column to the receiver's. */}
      {messages.map(({ element, fromCol, toCol, accent }) => (
        <MessageArrow
          key={element.id}
          element={element}
          left={left}
          top={top}
          fromX={fromCol.position.x}
          toX={toCol.position.x}
          accent={accent}
        />
      ))}
    </div>
  );
}

function orderOf(element: CanvasElement): number {
  const order = Number(rawMeta(element, "order"));
  return Number.isFinite(order) ? order : 0;
}

interface MessageArrowProps {
  element: CanvasElement;
  left: number;
  top: number;
  fromX: number;
  toX: number;
  accent: string;
}

function MessageArrow({ element, left, top, fromX, toX, accent }: MessageArrowProps) {
  const isReturn = flagMeta(element, "return");
  const isAsync = flagMeta(element, "async");
  const arrowClass = [
    "sequence-message",
    isReturn ? "sequence-message--return" : "",
    isAsync ? "sequence-message--async" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const y = element.position.y - top;
  // The arrow spans exactly between the two participants' columns (their persisted x). Its line runs
  // from one lifeline's center to the other, so each end lands ON the dashed vertical -- the arrowhead
  // touches the receiving lifeline instead of stopping short of it.
  const span = Math.abs(toX - fromX);
  const left0 = Math.min(fromX, toX) - left;
  const style = {
    left: left0,
    top: y - 10,
    width: span,
    "--seq-accent-rgb": accent,
  } as CSSProperties;

  const onClick = () =>
    descriptionPopupStore.open(
      element.label || "Message",
      element.description || `Message ${element.label || element.id}`,
    );

  return (
    <div
      key={element.id}
      className={arrowClass}
      data-testid="sequence-message"
      style={style}
      onClick={onClick}
    >
      <span
        className="sequence-message-label"
        style={{ maxWidth: Math.max(span - 8, 40) }}
      >
        {element.label}
      </span>
      <span
        className="sequence-message-line"
        style={isReturn ? { transform: "scaleX(-1)" } : undefined}
      />
    </div>
  );
}

/** The per-participant accent palette, as `{r,g,b}` — kept in sync with groupColor.ts's
 * `GROUP_COLOR_COUNT`/`groupColorIndex` and styles.css's `.canvas-group-frame-color-<n>` hexes (so a
 * participant hashes to the same hue family the shared palette uses). Rendered as the inline
 * `--seq-accent-rgb: r, g, b` CSS variable that the `.sequence-*` rules read. */
const SEQUENCE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [99, 102, 241],    // indigo
  [52, 211, 153],    // green
  [245, 158, 11],    // amber
  [244, 114, 182],   // pink
  [167, 139, 250],   // violet
  [34, 211, 238],    // cyan
];
if (SEQUENCE_PALETTE.length !== GROUP_COLOR_COUNT) {
  throw new Error("SEQUENCE_PALETTE out of sync with GROUP_COLOR_COUNT");
}

/** The `--seq-accent-rgb` value (a bare `r, g, b` string) for a participant's own stable hue. */
function sequenceAccentRef(ref: string): string {
  const [r, g, b] = SEQUENCE_PALETTE[groupColorIndex(ref) % SEQUENCE_PALETTE.length];
  return `${r}, ${g}, ${b}`;
}

/** Default fallback head footprint when a participant carries no `size` (layoutSequence always
 * writes one, but a hand-authored layer may not) — matches the layout's own participant size. */
const HEAD_W = 180;
const HEAD_H = 36;
