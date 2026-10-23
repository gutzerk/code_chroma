import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CanvasDoc, CanvasElement } from "../../../state/types";
import { useCanvasFocus } from "../../CanvasFocusContext";
import { elementRect } from "../elementRect";
import type { QuestionOption } from "./questionAdapter";
import { QUESTION_STRINGS as S } from "./questionStrings";

const MAX_NODES = 40;
const PAD = 24;

/** The element an option points at plus its children: members of its group and everything reachable along its arrows. */
export function diagramSubgraph(doc: CanvasDoc, rootId: string): CanvasElement[] {
  const root = doc.elements[rootId];
  if (!root) return [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0 && seen.size < MAX_NODES) {
    const id = queue.shift() as string;
    const next = [
      ...Object.values(doc.edges).filter((e) => e.from === id).map((e) => e.to),
      ...Object.values(doc.elements).filter((el) => el.group_id === id).map((el) => el.id),
    ];
    for (const n of next) {
      if (doc.elements[n] && !seen.has(n) && seen.size < MAX_NODES) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return [...seen].map((id) => doc.elements[id]);
}

export interface QuestionDiagramProps {
  doc: CanvasDoc;
  options: QuestionOption[];
  selectedId: string | null;
  onSelect: (optionId: string) => void;
  /** "pane" is the A4 side pane with option tabs; "box" is the B1 box under the options. */
  variant: "pane" | "box";
}

/** Read-only diagram of the selected option's `diagram_ref`, scaled to fit with zoom and a full-screen overlay. */
export function QuestionDiagram({ doc, options, selectedId, onSelect, variant }: QuestionDiagramProps) {
  const focusCanvas = useCanvasFocus();
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(1);

  const selectedIndex = options.findIndex((o) => o.id === selectedId);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const withDiagram = options.map((o, i) => ({ option: o, n: i + 1 })).filter(({ option }) => option.diagramRef);
  const root = selected?.diagramRef ? doc.elements[selected.diagramRef] : undefined;
  const nodes = useMemo(() => (root ? diagramSubgraph(doc, root.id) : []), [doc, root]);

  const layout = useMemo(() => {
    if (nodes.length === 0) return null;
    const rects = nodes.map((el) => ({ el, rect: elementRect(el) }));
    const left = Math.min(...rects.map((r) => r.rect.left)) - PAD;
    const top = Math.min(...rects.map((r) => r.rect.top)) - PAD;
    const right = Math.max(...rects.map((r) => r.rect.left + r.rect.width)) + PAD;
    const bottom = Math.max(...rects.map((r) => r.rect.top + r.rect.height)) + PAD;
    return { rects, left, top, width: right - left, height: bottom - top };
  }, [nodes]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !layout) return;
    const { clientWidth, clientHeight } = body;
    if (clientWidth > 0 && clientHeight > 0) setFit(Math.min(clientWidth / layout.width, clientHeight / layout.height, 1));
  }, [layout, full, variant]);

  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const scale = fit * zoom;
  const byId = new Map(nodes.map((el) => [el.id, el]));
  const edges = Object.values(doc.edges).filter((e) => byId.has(e.from) && byId.has(e.to));

  return (
    <div
      className={`aq-diagram${variant === "box" ? " aq-diagram--box" : ""}${full ? " aq-diagram--full" : ""}`}
      data-testid="question-diagram"
    >
      <div className="aq-diagram-head">
        {variant === "pane" ? (
          <div className="aq-diagram-tabs" role="tablist">
            {withDiagram.map(({ option, n }) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                className="aq-diagram-tab"
                aria-selected={option.id === selectedId}
                onClick={() => onSelect(option.id)}
              >
                {S.optionTab(n, option.title)}
              </button>
            ))}
          </div>
        ) : (
          <>
            <b>{selected ? S.diagramOf(selectedIndex + 1, selected.title) : ""}</b>
            <span>{S.followsSelection}</span>
            <span className="question-header-gap" />
            {root && (
              <button type="button" className="question-quiet" onClick={() => focusCanvas(root.node_id ?? root.id)}>
                {S.openOnCanvas}
              </button>
            )}
            <button type="button" className="question-quiet" onClick={() => setFull((v) => !v)}>
              {full ? S.closeFullScreen : S.fullScreen}
            </button>
          </>
        )}
      </div>
      <div className="aq-diagram-body" ref={bodyRef}>
        {layout ? (
          <div
            className="aq-diagram-stage"
            style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
          >
            <svg className="aq-diagram-edges" width={layout.width} height={layout.height}>
              {edges.map((e) => {
                const a = elementRect(byId.get(e.from) as CanvasElement);
                const b = elementRect(byId.get(e.to) as CanvasElement);
                return (
                  <line
                    key={e.id}
                    x1={a.left + a.width / 2 - layout.left}
                    y1={a.top + a.height / 2 - layout.top}
                    x2={b.left + b.width / 2 - layout.left}
                    y2={b.top + b.height / 2 - layout.top}
                  />
                );
              })}
            </svg>
            {layout.rects.map(({ el, rect }) => (
              <div
                key={el.id}
                className="aq-diagram-node"
                data-testid="question-diagram-node"
                data-new={el.meta.status === "new" || undefined}
                style={{ left: rect.left - layout.left, top: rect.top - layout.top, width: rect.width, height: rect.height }}
              >
                {el.label}
              </div>
            ))}
          </div>
        ) : (
          <div className="aq-diagram-empty">{S.noDiagram}</div>
        )}
        <div className="aq-diagram-tools">
          <button type="button" aria-label={S.zoomOut} onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>−</button>
          <button type="button" aria-label={S.zoomIn} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>+</button>
          <button type="button" aria-label={S.zoomFit} onClick={() => setZoom(1)}>⤢</button>
          {variant === "pane" && (
            <button type="button" aria-label={full ? S.closeFullScreen : S.fullScreen} onClick={() => setFull((v) => !v)}>
              {full ? "×" : "⛶"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
