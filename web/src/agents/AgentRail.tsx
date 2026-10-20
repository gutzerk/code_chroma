import "./AgentRailHandles.css";
import { layoutStore } from "../canvas/layout/layoutStore";
import { RailButton } from "../canvas/RailButton";
import type { AgentRecord } from "../state/types";
import { useAgentClient } from "./AgentClientContext";
import { agentStatusLabel } from "./AgentLed";
import { agentStore, useAgents, useDiagramsReady } from "./agentStore";
import { baseBranchOf, isAgentOnBranch } from "./branchScope";
import { useCurrentBranch } from "./branchStore";
import { closeAgentWindow, minimizeAgentWindow, restoreAgentWindow } from "./windowActions";
import { agentDockStore, useDockedAgentIds } from "./agentDockStore";
import { featureById } from "../tutorial/tutorialPlan";
import { tutorialSimStore, useTutorialSim } from "../tutorial/tutorialSim";
import { useTutorialActive } from "../tutorial/tutorialStore";

/**
 * The agent task panel: a full-height dock beside the canvas, one card per agent for its whole
 * lifetime, and the only place a minimized window can be reopened from without a window of its own.
 * Minimizing does not remove its card, it only flips `aria-pressed`; a docked agent also stays
 * pressed, and selecting it switches the active dock tab.
 *
 * Diagrams are no longer listed here: they live in the left panel (`canvas/leftpanel/`).
 *
 * An agent belonging to another branch than the one main has checked out still opens on click, same
 * as any other agent: its own worktree is untouched by whatever main has checked out (AgentWindow.tsx
 * no longer hides it for that reason), so there is nothing to gate on a branch switch. This used to
 * check that branch back out first (`openAgentOnItsBranch`), but the checkout could fail on a dirty
 * main tree and keep failing on every retry, permanently trapping the card behind a hidden window
 * with no way to close it — dropped for exactly that incident. Such a row stays dimmed and named by
 * its branch purely as information now, plus its own close button beside the card (not inside its
 * window) as a quick way to remove it without opening the window first.
 *
 * The title and status render as plain text next to the LED (not just the hover tooltip) so a
 * minimized window still says which task it is and what it's doing at a glance.
 *
 * ⚠ The dot is a bare span rather than `<AgentLed>`: that component sets a native `title`, which
 * would raise a second, OS-styled tooltip inside a button whose whole point is `.rail-tooltip`. Only
 * the accessibility wrapper differs — the colour map is still the one in styles.css.
 */
export function AgentRail({ hidden = false }: { hidden?: boolean }) {
  const agentClient = useAgentClient();
  const agents = useAgents();
  const dockedAgentIds = useDockedAgentIds();
  const current = useCurrentBranch();
  const diagramsReady = useDiagramsReady();
  const tutorialActive = useTutorialActive();
  const sim = useTutorialSim();
  const simRows = tutorialActive ? tutorialAgentRows(sim) : [];
  return (
    <div className="agent-task-rail" data-testid="agent-task-rail" hidden={hidden}>
      <div className="agent-task-rail-handles">
        <button
          type="button"
          className="agent-task-rail-handle"
          aria-label="Collapse agents panel"
          data-testid="agent-panel-collapse"
          onClick={() => layoutStore.setAgentsMode("collapsed")}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
        <button
          type="button"
          className="agent-task-rail-handle"
          aria-label="Expand agents to full screen"
          data-testid="agent-panel-expand"
          onClick={() => layoutStore.setAgentsMode("full")}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>
      <div className="agent-task-rail-tabpanel">
          <div className="agent-task-rail-header">
            <span className="agent-task-rail-label">Agent tasks</span>
            <span className="agent-task-rail-count">{agents.length + simRows.length}</span>
          </div>
          <div className="agent-task-rail-body">
            {simRows.map((row) => (
              <div className="agent-rail-row" key={row.id}>
                <RailButton
                  className="agent-rail-item"
                  testId={`agent-rail-${row.id}`}
                  label={`${row.title} — ${agentStatusLabel(row.status)}`}
                  pressed={row.open}
                  onClick={row.onClick}
                >
                  <span className={`agent-led agent-led-${row.status}`} aria-hidden="true" />
                  <span className="agent-rail-preview">
                    <span className="agent-rail-title">{row.title}</span>
                    <span className="agent-rail-status">{agentStatusLabel(row.status)}</span>
                  </span>
                </RailButton>
              </div>
            ))}
            {agents.map((agent) => {
              const onBranch = isAgentOnBranch(agent, current);
              const hasDiagram = diagramsReady.has(agent.id);
              const isDocked = dockedAgentIds.includes(agent.id);
              return (
                <div className="agent-rail-row" key={agent.id}>
                  <RailButton
                    className={`agent-rail-item${onBranch ? "" : " agent-rail-item-off-branch"}`}
                    testId={`agent-rail-${agent.id}`}
                    label={tooltipFor(agent, onBranch, hasDiagram)}
                    pressed={isDocked || !agent.window.minimized}
                    onClick={() => {
                      // Clicking is the acknowledgement: restoring also activates that workspace,
                      // where useDiagramReadinessWatcher adds the diagram without further prompting.
                      agentStore.clearDiagramsReady(agent.id);
                      layoutStore.selectAgent(agent.id);
                      if (isDocked) {
                        agentDockStore.activate(agent.id);
                        agentDockStore.expand();
                        restoreAgentWindow(agentClient, agent.id);
                      } else if (agent.window.minimized) restoreAgentWindow(agentClient, agent.id);
                      else minimizeAgentWindow(agentClient, agent.id);
                    }}
                  >
                    <span className={`agent-led agent-led-${agent.status}`} aria-hidden="true" />
                    <span className="agent-rail-preview">
                      <span className="agent-rail-title">{agent.title}</span>
                      <span className="agent-rail-status">
                        {onBranch ? agentStatusLabel(agent.status) : `on ${baseBranchOf(agent)}`}
                      </span>
                    </span>
                    {/* Not an `agent-rail-*` test id on purpose: the strip's own tests count rows
                        with `getAllByTestId(/^agent-rail-/)`, which this would join. */}
                    {hasDiagram && (
                      <span
                        className="agent-rail-diagram-badge"
                        data-testid={`diagram-ready-${agent.id}`}
                        aria-hidden="true"
                      />
                    )}
                  </RailButton>
                  {!onBranch && (
                    <button
                      type="button"
                      className="agent-rail-close"
                      aria-label={`Close ${agent.title}`}
                      data-testid={`agent-rail-close-${agent.id}`}
                      onClick={() => closeAgentWindow(agentClient, agent.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
      </div>
    </div>
  );
}

function tooltipFor(agent: AgentRecord, onBranch: boolean, hasDiagram = false): string {
  // The badge is the only cue that a finished agent drew something in its own, unvisited workspace.
  if (hasDiagram) return `${agent.title} — drew a diagram; open to see it`;
  if (!onBranch) return `${agent.title} — on ${baseBranchOf(agent)}`;
  return `${agent.title} — ${agentStatusLabel(agent.status)}`;
}

interface TutorialAgentRow {
  id: string;
  title: string;
  status: AgentRecord["status"];
  open: boolean;
  onClick: () => void;
}

/** The lesson's pretend agents, shown with the same card markup as real ones. */
function tutorialAgentRows(sim: ReturnType<typeof useTutorialSim>): TutorialAgentRow[] {
  const rows: TutorialAgentRow[] = [];
  if (sim.agent1Listed) {
    rows.push({
      id: "tutorial-1",
      title: "Draw a diagram",
      status: "idle",
      open: sim.agent === "open",
      onClick: tutorialSimStore.openAgent,
    });
  }
  if (sim.agent2 !== "none") {
    rows.push({
      id: "tutorial-2",
      title: sim.feature ? `Build: ${featureById(sim.feature)?.label ?? "feature"}` : "Build the feature",
      status: sim.agent2 === "working" ? "working" : "idle",
      open: sim.agent2Window,
      onClick: tutorialSimStore.openAgent2Window,
    });
  }
  return rows;
}
