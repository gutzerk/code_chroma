import { useEffect, useRef, type ReactNode } from "react";
import { useResizableSize } from "../canvas/useResizableSize";
import { EdgeHandle } from "./EdgeHandle";
import { LeftCollapsedStrip } from "./LeftCollapsedStrip";
import { LEFT_MIN_WIDTH, shellStore, useShellState, type LeftTab } from "./shellStore";
import "./leftPanel.css";

export interface LeftPanelProps {
  diagramsTab: ReactNode;
  filesTab: ReactNode;
}

const TABS: { id: LeftTab; label: string }[] = [
  { id: "diagrams", label: "Diagrams" },
  { id: "files", label: "Files" },
];

/** Floating left panel with Diagrams / Files tabs; both bodies stay mounted so tab state survives. */
export function LeftPanel({ diagramsTab, filesTab }: LeftPanelProps) {
  const { left } = useShellState();
  const panelRef = useRef<HTMLElement | null>(null);
  const { size, isResizing, handleProps, resetSize } = useResizableSize(panelRef, {
    axis: "x",
    edge: "right",
    minWidth: LEFT_MIN_WIDTH,
  });

  useEffect(() => {
    if (isResizing || !size) return;
    shellStore.setLeftWidth(size.width);
    resetSize();
  }, [size, isResizing, resetSize]);

  if (left.mode === "collapsed") return <LeftCollapsedStrip />;

  return (
    <aside
      ref={panelRef}
      className="left-panel"
      data-testid="left-panel"
      style={{ width: size?.width ?? left.width }}
    >
      <div className="left-panel-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="left-panel-tab"
            aria-selected={left.tab === tab.id}
            onClick={() => shellStore.setLeftTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="left-panel-body" role="tabpanel" hidden={left.tab !== "diagrams"}>
        {diagramsTab}
      </div>
      <div className="left-panel-body" role="tabpanel" hidden={left.tab !== "files"}>
        {filesTab}
      </div>
      <EdgeHandle
        edge="right"
        testId="left-panel-handle"
        resizeHandleProps={handleProps}
        actions={[{ label: "Collapse panel", glyph: "‹", onClick: shellStore.collapseLeft }]}
      />
    </aside>
  );
}
