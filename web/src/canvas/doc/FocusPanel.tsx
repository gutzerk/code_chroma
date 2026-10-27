import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CanvasDoc } from "../../state/types";
import { neighbourLinks, type FocusDirection, type NeighbourLink } from "./focusNeighbors";
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
  const { calledBy, uses } = neighbourLinks(doc, focus.id);
  const label = (id: string) => doc.elements[id]?.label ?? id;
  const directions: Array<[FocusDirection, string]> = [
    ["upstream", "Upstream"],
    ["downstream", "Downstream"],
  ];
  const row = (link: NeighbourLink, arrow: string) => (
    <li key={link.id} data-visual={link.visual}>
      <span className="canvas-focus-panel__arrow">{arrow}</span> {label(link.id)}
      {link.label && <span className="canvas-focus-panel__edge"> ({link.label})</span>}
    </li>
  );
  // Portalled out of the pan/zoom transform into .canvas-area (body in a bare test) so it sits beside the left panel.
  return createPortal(
    <aside className="canvas-focus-panel" data-testid="canvas-focus-panel">
      <div className="canvas-focus-panel__head">
        <span className="canvas-focus-panel__kicker">FOCUS</span>
        <button type="button" className="canvas-focus-panel__close" aria-label="Clear focus" onClick={() => focusStore.clear()}>
          ✕
        </button>
      </div>
      <strong className="canvas-focus-panel__name">{element.label}</strong>
      <span className="canvas-focus-panel__help">Click a block: its direct neighbours stay lit and the rest fades.</span>
      <h4>{`CALLED BY · ${calledBy.length}`}</h4>
      <ul data-testid="focus-called-by">{calledBy.map((link) => row(link, "←"))}</ul>
      <h4>{`USES · ${uses.length}`}</h4>
      <ul data-testid="focus-uses">{uses.map((link) => row(link, link.visual === "spawn" ? "⇢" : "→"))}</ul>
      <div role="group" aria-label="Focus direction" className="canvas-focus-panel__dirs">
        {directions.map(([value, text]) => (
          <button
            key={value}
            type="button"
            className={focus.direction === value ? "canvas-focus-panel__dir canvas-focus-panel__dir--on" : "canvas-focus-panel__dir"}
            aria-pressed={focus.direction === value}
            onClick={() => focusStore.setDirection(doc, focus.direction === value ? "both" : value)}
          >
            {text}
          </button>
        ))}
      </div>
    </aside>,
    document.querySelector(".canvas-area") ?? document.body,
  );
}
