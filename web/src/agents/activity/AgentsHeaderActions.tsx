import type { AgentsMode } from "../../canvas/layout/layoutStore";
import { PanelModeActions } from "./PanelModeActions";
import { PlusIcon } from "./icons";

/** The activity header's right side on the Agents tab: Run new agent, full screen ("Exit full screen" while full) and collapse. */
export function AgentsHeaderActions({
  agentsMode,
  disabled,
  onRunAgent,
}: {
  agentsMode: AgentsMode;
  disabled: boolean;
  onRunAgent: () => void;
}) {
  return (
    <>
      <span className="activity-spacer" />
      <span className="activity-break" aria-hidden="true" />
      <button type="button" className="activity-primary" aria-label="Run agent" title="Run agent" disabled={disabled} onClick={onRunAgent}>
        <PlusIcon size={14} />
        Run new agent
      </button>
      <PanelModeActions agentsMode={agentsMode} />
    </>
  );
}
