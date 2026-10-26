import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CanvasDoc } from "../../state/types";
import { neighboursOf, type FocusDirection } from "./focusNeighbors";
import { focusStore } from "./focusStore";

/** Side panel for the focused block: CALLED BY / USES lists and the Upstream / Downstream toggle. */
export function FocusPanel({ doc }: { doc: CanvasDoc }) {
  useSyncExternalStore(focusStore.subscribe, focusStore.getVersion);
  const focus = focusStore.current();
  const element = focus ? doc.elements[focus.id] : undefined;
  const missing = focus !== null && !element;
  // A focused block that left the doc (reanalyze, diff) must not leave the rest of the canvas dimmed.
  useEffect(() => {
    if (missing) focusStore.clear();
  }, [missing]);
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && focusStore.clear();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);
  if (!focus || !element) return null;
  const { calledBy, uses } = neighboursOf(doc, focus.id);
  const label = (id: string) => doc.elements[id]?.label ?? id;
  const directions: Array<[FocusDirection, string]> = [
    ["both", "Both"],
    ["upstream", "Upstream"],
    ["downstream", "Downstream"],
  ];
  // Portalled out of the pan/zoom transform into .canvas-area (body in a bare test) so it sits beside the left panel.
  return createPortal(
    <aside className="canvas-focus-panel" data-testid="canvas-focus-panel">
      <strong>{element.label}</strong>
      <div role="group" aria-label="Focus direction" style={{ display: "flex", gap: 4, marginTop: 6 }}>
        {directions.map(([value, text]) => (
          <button
            key={value}
            type="button"
            className={focus.direction === value ? "sequence-mode-btn sequence-mode-btn--on" : "sequence-mode-btn"}
            aria-pressed={focus.direction === value}
            onClick={() => focusStore.setDirection(doc, value)}
          >
            {text}
          </button>
        ))}
        <button type="button" className="sequence-mode-btn" onClick={() => focusStore.clear()}>
          ✕
        </button>
      </div>
      <h4>CALLED BY</h4>
      <ul data-testid="focus-called-by">{calledBy.length ? calledBy.map((id) => <li key={id}>{label(id)}</li>) : <li>none</li>}</ul>
      <h4>USES</h4>
      <ul data-testid="focus-uses">{uses.length ? uses.map((id) => <li key={id}>{label(id)}</li>) : <li>none</li>}</ul>
    </aside>,
    document.querySelector(".canvas-area") ?? document.body,
  );
}
