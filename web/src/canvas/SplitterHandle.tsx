import type { PointerEvent, ReactNode } from "react";
import type { ResizeHandleProps } from "./useResizableSize";

export interface SplitterHandleProps {
  /** Positions/sizes the strip — the same box a plain resize handle used (e.g.
   * `project-tree-panel-resize-handle`), so adopting this component changes no layout. */
  className: string;
  dataTestid: string;
  /** Drag-to-resize pointer handlers; omit for a collapse-only splitter with nothing to resize
   * (the agent rail, which only ever toggles fully open/closed, never drags). */
  resizeHandleProps?: ResizeHandleProps;
  collapsed: boolean;
  onToggle: () => void;
  ariaLabel: string;
  /** The chevron glyph, already resolved by the caller for its own anchor side (e.g. `‹`/`›`). */
  arrow: ReactNode;
}

/**
 * A panel-edge splitter: the whole strip stays draggable for resize (when `resizeHandleProps` is
 * given) and highlights on hover/focus, while a small arrow button scales/fades in from its center
 * to collapse or expand the panel — replacing the old always-visible corner toggle buttons.
 * `stopPropagation` on the arrow's own pointer-down keeps clicking it from also starting a resize
 * drag on the strip underneath.
 */
export function SplitterHandle({
  className,
  dataTestid,
  resizeHandleProps,
  collapsed,
  onToggle,
  ariaLabel,
  arrow,
}: SplitterHandleProps) {
  return (
    <div className={`panel-splitter ${className}`} data-testid={dataTestid} {...resizeHandleProps}>
      <button
        type="button"
        className="panel-splitter-arrow"
        aria-label={ariaLabel}
        aria-expanded={!collapsed}
        data-testid={`${dataTestid}-arrow`}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <span aria-hidden="true">{arrow}</span>
      </button>
    </div>
  );
}
