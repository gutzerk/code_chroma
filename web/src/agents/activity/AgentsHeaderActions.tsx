import type { AgentsMode } from "../../canvas/layout/layoutStore";
import { PanelModeActions } from "./PanelModeActions";
import { RunAgentButton } from "./RunAgentButton";

/** The activity header's right side on the Agents tab: Run new agent (hold it to pick a model), full screen ("Exit full screen" while full) and collapse. */
export function AgentsHeaderActions({
  agentsMode,
  disabled,
  onRunAgent,
}: {
  agentsMode: AgentsMode;
  disabled: boolean;
  onRunAgent: (model?: string) => void;
}) {
  return (
    <>
      <span className="activity-spacer" />
      <span className="activity-break" aria-hidden="true" />
      <RunAgentButton disabled={disabled} onRunAgent={onRunAgent} />
      <PanelModeActions agentsMode={agentsMode} />
    </>
  );
}
