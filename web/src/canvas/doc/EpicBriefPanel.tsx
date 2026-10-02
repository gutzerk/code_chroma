import { useMemo } from "react";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { EpicsDiagramClient } from "../../engine-client/epicsDiagramClient";
import { EpicBriefView } from "../epics/brief/EpicBriefView";
import { PanelCloseButton } from "../PanelCloseButton";
import { epicBriefPanelStore, useEpicBriefPanelItemId } from "./epicBriefPanelStore";

/**
 * Docked panel for one epic's AI brief, reusing the `.inspector-panel` shell — 016-single-canvas-
 * dashboard Stage 4 keeps `canvas/epics/brief/` alive after deleting `EpicsView.tsx`: an "epic"
 * element's box has no real hierarchy `node_id` to hand the InspectorPanel, so this is its own small
 * panel instead. Renders nothing while closed, so it can mount unconditionally in RootCanvas.
 */
export function EpicBriefPanel() {
  const itemId = useEpicBriefPanelItemId();
  const engineClient = useEngineClient();
  const client = useMemo(() => new EpicsDiagramClient(engineClient), [engineClient]);

  if (!itemId) return null;

  return (
    <aside className="inspector-panel" data-testid="epic-brief-panel" aria-label="Epic AI brief">
      <header className="inspector-panel-header">
        <span className="inspector-panel-title" data-testid="epic-brief-panel-title">
          {itemId}
        </span>
        <PanelCloseButton
          className="inspector-panel-close"
          ariaLabel="Close the epic brief"
          onClick={epicBriefPanelStore.close}
        />
      </header>
      <div className="inspector-panel-body">
        <EpicBriefView itemId={itemId} client={client} />
      </div>
    </aside>
  );
}
