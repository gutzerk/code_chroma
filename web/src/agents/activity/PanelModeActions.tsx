import { layoutStore, type AgentsMode } from "../../canvas/layout/layoutStore";
import { CollapseIcon, ExitFullScreenIcon, FullScreenIcon } from "./icons";

/** The activity header's last controls on either tab: "Exit full screen" while full, else Full screen and collapse. */
export function PanelModeActions({ agentsMode }: { agentsMode: AgentsMode }) {
  if (agentsMode === "full") {
    return (
      <button type="button" className="activity-outline" onClick={layoutStore.toggleAgentsFull}>
        <ExitFullScreenIcon />
        Exit full screen
      </button>
    );
  }
  return (
    <>
      <button type="button" className="activity-icon-btn activity-ghost" aria-label="Full screen" title="Full screen" onClick={layoutStore.toggleAgentsFull}>
        <FullScreenIcon />
      </button>
      <button type="button" className="activity-icon-btn activity-ghost activity-collapse" aria-label="Collapse agents and workflows" title="Collapse" onClick={() => layoutStore.setAgentsMode("collapsed")}>
        <CollapseIcon />
      </button>
    </>
  );
}
