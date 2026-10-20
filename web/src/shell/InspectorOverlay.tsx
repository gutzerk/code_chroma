import { useEffect } from "react";
import { InspectorPanel } from "../canvas/InspectorPanel";
import { inspectorStore, useIsInspectorOpen } from "../canvas/inspectorStore";
import { openFilesStore } from "../canvas/openFilesStore";
import { shellStore, useShellState } from "./shellStore";
import "./inspectorOverlay.css";

/** Keeps the shell's overlay flag and the inspector in step: opening shows the overlay, closing either one closes it. */
export function useInspectorOverlaySync(): void {
  const inspectorOpen = useIsInspectorOpen();
  const { codeOverlayOpen } = useShellState();
  useEffect(() => {
    if (inspectorOpen) shellStore.openCodeOverlay();
    else if (openFilesStore.getFiles().length === 0) shellStore.closeCodeOverlay();
  }, [inspectorOpen]);
  useEffect(() => {
    if (!codeOverlayOpen && inspectorStore.getIsOpen()) inspectorStore.close();
  }, [codeOverlayOpen]);
}

/** The box-click inspector (node details, epic work items, change review), laid over the agents panel like the code overlay. */
export function InspectorOverlay() {
  const open = useIsInspectorOpen();
  if (!open) return null;
  return (
    <div className="inspector-overlay" data-testid="inspector-overlay">
      <InspectorPanel />
    </div>
  );
}
