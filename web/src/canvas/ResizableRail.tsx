import { useRef, type ReactNode } from "react";
import { useResizableSize } from "./useResizableSize";
import { SplitterHandle } from "./SplitterHandle";

interface ResizableRailProps {
  /** Un-resized width (before the user drags the handle). */
  defaultWidth: number;
  minWidth: number;
  maxViewportFraction?: number;
  /** Base class on the aside; the `--resizing` flag is derived from the resize state. */
  className: string;
  resizingClass: string;
  ariaLabel: string;
  /** The aside's data-testid. */
  dataTestid: string;
  /** The resize handle's data-testid. */
  handleTestid: string;
  hidden: boolean;
  collapsed?: boolean;
  collapsedWidth?: number;
  /** When given, the resize handle also hosts a hover-reveal collapse/expand arrow (see
   * `SplitterHandle`) instead of being a plain drag-only strip. */
  collapseToggle?: {
    collapsed: boolean;
    onToggle: () => void;
    ariaLabel: string;
    arrow: ReactNode;
  };
  children: ReactNode;
}

/**
 * The resizable side-rail skeleton shared by the tree panel and the code sidebar — both are
 * left-anchored, right-edge-resizable aside+handle frames around differing content. Encapsulates
 * the `useResizableSize` wiring (width, --resizing state, pointer handle) both panels used to
 * re-implement, so the ~15-line aside+handle duplication lives in one place.
 */
export function ResizableRail({
  defaultWidth,
  minWidth,
  maxViewportFraction = 0.5,
  className,
  resizingClass,
  ariaLabel,
  dataTestid,
  handleTestid,
  hidden,
  collapsed = false,
  collapsedWidth,
  collapseToggle,
  children,
}: ResizableRailProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  // Both rails anchor on the left, so their right-edge handle widens them toward whatever is next
  // (the canvas for these two) — shared config, one place.
  const { size, isResizing, handleProps } = useResizableSize(panelRef, {
    axis: "x",
    edge: "right",
    minWidth,
    maxViewportFraction,
  });

  return (
    <aside
      className={`${className}${collapsed ? ` ${className}--collapsed` : ""}${
        isResizing ? ` ${resizingClass}` : ""
      }`}
      data-testid={dataTestid}
      aria-label={ariaLabel}
      ref={panelRef}
      style={{ width: collapsed ? collapsedWidth : size?.width ?? defaultWidth }}
      hidden={hidden}
    >
      {collapseToggle ? (
        <SplitterHandle
          className={`${className}-resize-handle`}
          dataTestid={handleTestid}
          resizeHandleProps={collapsed ? undefined : handleProps}
          collapsed={collapseToggle.collapsed}
          onToggle={collapseToggle.onToggle}
          ariaLabel={collapseToggle.ariaLabel}
          arrow={collapseToggle.arrow}
        />
      ) : (
        <div
          className={`${className}-resize-handle`}
          data-testid={handleTestid}
          aria-hidden="true"
          {...handleProps}
        />
      )}
      {children}
    </aside>
  );
}
