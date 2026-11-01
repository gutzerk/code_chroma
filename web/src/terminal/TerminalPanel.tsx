import { useEffect, useLayoutEffect, useRef } from "react";
import {
  terminalPanelStore,
  useActiveTerminalTab,
  useSelectedAgent,
  useTerminalTabs,
} from "./terminalPanelStore";
import { useXtermSession } from "./useXtermSession";
import { useResizableSize, type Size } from "../canvas/useResizableSize";

/** Resizable bottom dock with one independent shell PTY and xterm per terminal tab. */
export function TerminalPanel({ hidden = false, onHeightChange }: {
  hidden?: boolean;
  onHeightChange?: (height: number) => void;
}) {
  const tabs = useTerminalTabs();
  const activeTab = useActiveTerminalTab();
  const panelRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !onHeightChange) return;
    const measure = () => onHeightChange(hidden ? 0 : panel.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [hidden, onHeightChange]);
  const { size, isResizing, handleProps } = useResizableSize(panelRef, {
    axis: "y",
    edge: "top",
    minHeight: 160,
    maxViewportFraction: 0.6,
  });

  return (
    <div
      className={`terminal-panel${hidden ? " terminal-panel-hidden" : ""}${
        isResizing ? " terminal-panel-resizing" : ""
      }`}
      data-testid="terminal-panel"
      ref={panelRef}
      style={size ? { height: size.height } : undefined}
    >
      <div
        className="terminal-panel-resize-handle"
        data-testid="terminal-panel-resize-handle"
        aria-hidden="true"
        {...handleProps}
      />
      <div className="terminal-panel-toolbar">
        <div className="terminal-panel-tabs" role="tablist" aria-label="Terminals">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`terminal-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTab}
              aria-controls={`terminal-session-${tab.id}`}
              onClick={() => terminalPanelStore.selectTerminal(tab.id)}
            >
              {tab.title}
            </button>
          ))}
        </div>
        <button type="button" aria-label="New terminal" title="New terminal" onClick={terminalPanelStore.addTerminal}>
          +
        </button>
        <button
          type="button"
          aria-label="Close terminal"
          title="Close active terminal"
          onClick={() => terminalPanelStore.closeTerminal(activeTab)}
        >
          ×
        </button>
        <button
          type="button"
          aria-label="Hide terminal panel"
          title="Hide terminal panel (keep sessions running)"
          onClick={terminalPanelStore.hide}
        >
          −
        </button>
      </div>
      {tabs.map((tab) => (
        <TerminalTabSession key={tab.id} id={tab.id} hidden={hidden || tab.id !== activeTab} size={size} />
      ))}
    </div>
  );
}

function TerminalTabSession({ id, hidden, size }: { id: number; hidden: boolean; size: Size | null }) {
  const agent = useSelectedAgent();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { scheduleRefit } = useXtermSession(containerRef, {
    agent,
    hidden,
    closedNotice: "\r\n[session closed]\r\n",
  });
  useEffect(() => scheduleRefit(), [size, scheduleRefit]);
  return (
    <div
      id={`terminal-session-${id}`}
      role="tabpanel"
      aria-labelledby={`terminal-tab-${id}`}
      className="terminal-panel-container"
      hidden={hidden}
      ref={containerRef}
      data-testid="terminal-panel-container"
    />
  );
}
