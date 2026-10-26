import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CanvasDoc, CanvasElement } from "../../../state/types";
import { useCanvasDiagramFocus } from "../../CanvasFocusContext";
import { elementRect } from "../elementRect";
import type { QuestionOption } from "./questionAdapter";
import { QUESTION_STRINGS as S } from "./questionStrings";
import { usePanZoom } from "./usePanZoom";

const MAX_NODES = 40;
const PAD = 24;
const MIN_FIT = 0.7;
const MAX_FIT = 1.5;
const ZOOM_STEP = 1.25;

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

/** Read-only diagram of the selected option's `diagram_ref`: fits readably, pans and zooms, with a full-screen portal. */
export function QuestionDiagram({ doc, options, selectedId, onSelect, variant }: QuestionDiagramProps) {
  const focusDiagram = useCanvasDiagramFocus();
  const [full, setFull] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodySize, setBodySize] = useState({ w: 0, h: 0 });

  const selectedIndex = options.findIndex((o) => o.id === selectedId);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const withDiagram = options.map((o, i) => ({ option: o, n: i + 1 })).filter(({ option }) => option.diagramRef);
  const root = selected?.diagramRef ? doc.elements[selected.diagramRef] : undefined;
  const nodes = useMemo(() => (root ? diagramSubgraph(doc, root.id) : []), [doc, root]);
  const rootIsFrame = root?.render === "group";

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
    if (!body || !layout) return undefined;
    const measure = () => setBodySize({ w: body.clientWidth, h: body.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [layout, full, variant]);

  const base = useMemo(() => {
    if (!layout || bodySize.w <= 0 || bodySize.h <= 0) return { x: 0, y: 0, scale: 1 };
    const fit = Math.min(bodySize.w / layout.width, bodySize.h / layout.height);
    const scale = Math.min(MAX_FIT, Math.max(MIN_FIT, fit));
    // Overflowing content anchors to the top-left so the user pans from its start.
    return {
      scale,
      x: Math.max(0, (bodySize.w - layout.width * scale) / 2),
      y: Math.max(0, (bodySize.h - layout.height * scale) / 2),
    };
  }, [layout, bodySize]);

  const { view, dragging, zoomBy, reset, bind } = usePanZoom(bodyRef, base, Boolean(layout));

  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const byId = new Map(nodes.map((el) => [el.id, el]));
  const edges = Object.values(doc.edges).filter((e) => byId.has(e.from) && byId.has(e.to));
  const frameRect = root && rootIsFrame && layout ? elementRect(root) : null;
  const openOnCanvas = root ? (
    <button
      type="button"
      className="question-quiet"
      onClick={() => {
        setFull(false);
        focusDiagram(root.layer);
      }}
    >
      {S.openOnCanvas}
    </button>
  ) : null;

  const content = (
    <div
      className={`aq-diagram${variant === "box" ? " aq-diagram--box" : ""}${full ? " aq-diagram--full" : ""}`}
      data-testid="question-diagram"
    >
      <div className="aq-diagram-head">
        {variant === "pane" ? (
          <>
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
            <span className="question-header-gap" />
            {openOnCanvas}
          </>
        ) : (
          <>
            <b>{selected ? S.diagramOf(selectedIndex + 1, selected.title) : ""}</b>
            <span>{S.followsSelection}</span>
            <span className="question-header-gap" />
            {openOnCanvas}
            <button type="button" className="question-quiet" onClick={() => setFull((v) => !v)}>
              {full ? S.closeFullScreen : S.fullScreen}
            </button>
          </>
        )}
      </div>
      <div className={`aq-diagram-body${dragging ? " aq-diagram-body--dragging" : ""}`} ref={bodyRef} {...(layout ? bind : {})}>
        {layout ? (
          <div
            className="aq-diagram-stage"
            data-testid="question-diagram-stage"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          >
            {root && frameRect && (
              <div
                className="aq-diagram-frame"
                data-testid="question-diagram-frame"
                style={{ left: frameRect.left - layout.left, top: frameRect.top - layout.top, width: frameRect.width, height: frameRect.height }}
              >
                <span className="aq-diagram-frame-label">{root.label}</span>
              </div>
            )}
            <svg className="aq-diagram-edges" width={layout.width} height={layout.height}>
              <defs>
                <marker id="aq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="aq-diagram-arrow" />
                </marker>
              </defs>
              {edges.map((e) => {
                const a = elementRect(byId.get(e.from) as CanvasElement);
                const b = elementRect(byId.get(e.to) as CanvasElement);
                const x1 = a.left + a.width / 2 - layout.left;
                const y1 = a.top + a.height / 2 - layout.top;
                const x2 = b.left + b.width / 2 - layout.left;
                const y2 = b.top + b.height / 2 - layout.top;
                return (
                  <g key={e.id}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#aq-arrow)" />
                    {e.label && (
                      <text className="aq-diagram-edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2} textAnchor="middle" dominantBaseline="middle">
                        {e.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {layout.rects
              .filter(({ el }) => !(rootIsFrame && el.id === root?.id))
              .map(({ el, rect }) => (
                <div
                  key={el.id}
                  className="aq-diagram-node"
                  data-testid="question-diagram-node"
                  data-new={el.meta.status === "new" || undefined}
                  style={{ left: rect.left - layout.left, top: rect.top - layout.top, width: rect.width, height: rect.height }}
                >
                  <span className="aq-diagram-node-label">{el.label}</span>
                  {el.description && (
                    <span className="aq-diagram-node-desc" title={el.description}>
                      {el.description}
                    </span>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="aq-diagram-empty">{S.noDiagram}</div>
        )}
        <div className="aq-diagram-tools">
          <button type="button" aria-label={S.zoomOut} onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
          <button type="button" aria-label={S.zoomIn} onClick={() => zoomBy(ZOOM_STEP)}>+</button>
          <button type="button" aria-label={S.zoomFit} onClick={reset}>⤢</button>
          {variant === "pane" && (
            <button type="button" aria-label={full ? S.closeFullScreen : S.fullScreen} onClick={() => setFull((v) => !v)}>
              {full ? "×" : "⛶"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return full ? createPortal(content, document.body) : content;
}
