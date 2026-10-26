import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CanvasDoc, CanvasElement } from "../../../state/types";
import { useCanvasFocus } from "../../CanvasFocusContext";
import { elementRect } from "../elementRect";
import type { QuestionOption } from "./questionAdapter";
import { QUESTION_STRINGS as S } from "./questionStrings";

const MAX_NODES = 40;
const PAD = 24;
/** Smallest fit scale, so labels stay readable; a larger diagram is panned instead of shrunk. */
const MIN_FIT = 0.6;

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
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

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
    if (!body || !layout) return undefined;
    const measure = () => {
      const { clientWidth, clientHeight } = body;
      if (clientWidth > 0 && clientHeight > 0) setFit(Math.max(MIN_FIT, Math.min(clientWidth / layout.width, clientHeight / layout.height, 1)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [layout, full, variant]);

  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [root?.id]);

  const scale = fit * zoom;
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".aq-diagram-tools")) return;
    dragRef.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d) setPan({ x: d.px + event.clientX - d.x, y: d.py + event.clientY - d.y });
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    setZoom((z) => Math.min(3, Math.max(0.25, z * (event.deltaY < 0 ? 1.1 : 1 / 1.1))));
  };
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
      <div
        className="aq-diagram-body"
        ref={bodyRef}
        data-testid="question-diagram-body"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        {layout ? (
          <div
            className="aq-diagram-stage"
            style={{ width: layout.width, height: layout.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
          >
            <svg className="aq-diagram-edges" width={layout.width} height={layout.height}>
              <defs>
                <marker id="aq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" fill="currentColor" stroke="none" />
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
                      <text className="aq-diagram-edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2} textAnchor="middle">
                        {e.label}
                      </text>
                    )}
                  </g>
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
                <b>{el.label}</b>
                {el.description && <span>{el.description}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="aq-diagram-empty">{S.noDiagram}</div>
        )}
        <div className="aq-diagram-tools">
          <button type="button" aria-label={S.zoomOut} onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>−</button>
          <button type="button" aria-label={S.zoomIn} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>+</button>
          <button type="button" aria-label={S.zoomFit} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>⤢</button>
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
