import { useEffect, useMemo, useState } from "react";
import { useCanvasDoc } from "../canvas/doc/canvasDocStore";
import { collapsedLayersStore, useCollapsedLayers } from "../canvas/doc/collapsedLayersStore";
import {
  deleteDiagramAndRefresh,
  labelForDiagramLayer,
  listActiveDiagramLayers,
  useCustomDiagramTypes,
} from "../canvas/doc/diagramCatalog";
import { RailButton } from "../canvas/RailButton";
import { useEngineClient } from "../engine-client/EngineClientContext";
import type { AgentRecord } from "../state/types";
import { useAgentClient } from "./AgentClientContext";
import { agentStatusLabel } from "./AgentLed";
import { agentStore, useAgents, useDiagramsReady } from "./agentStore";
import { baseBranchOf, isAgentOnBranch } from "./branchScope";
import { useCurrentBranch } from "./branchStore";
import { DeleteDiagramDialog } from "./DeleteDiagramDialog";
import { closeAgentWindow, minimizeAgentWindow, restoreAgentWindow } from "./windowActions";
import { agentDockStore, useDockedAgentIds } from "./agentDockStore";
import { featureById } from "../tutorial/tutorialPlan";
import { tutorialSimStore, useTutorialSim } from "../tutorial/tutorialSim";
import { useTutorialActive } from "../tutorial/tutorialStore";

type RailTab = "agents" | "diagrams";

/**
 * The agent task panel: a full-height dock beside the canvas, one card per agent for its whole
 * lifetime, and the only place a minimized window can be reopened from without a window of its own.
 * Minimizing does not remove its card, it only flips `aria-pressed`; a docked agent also stays
 * pressed, and selecting it switches the active dock tab.
 *
 * A second "Diagrams" tab shares this same dock and is now the *only* place a diagram is shown and
 * managed (016-single-canvas-dashboard Stage 4 originally split this with `RecipeMenu`'s dropdown;
 * the diagram-management unification retired that dropdown down to a plain "Draw…" button — see
 * `DrawDiagramButton.tsx` — and moved everything else here). Two sections:
 *
 * - **On canvas** — one row per diagram layer currently placed (`listActiveDiagramLayers`). Clicking
 *   a row toggles `collapsedLayersStore` rather than opening a window — collapsed hides that
 *   diagram's elements/edges from CanvasDocView without deleting them, expanded shows them again. The
 *   toggle is a pure visibility flip in both directions — no recipe re-run, so expanding never
 *   re-shuffles (or briefly shows "Refreshing…" over) a diagram; layers catch up with their on-disk
 *   artifact on their own via `DrawDiagramButton`'s readiness/fingerprint watcher. Each row also
 *   carries a delete button (hard — opens `DeleteDiagramDialog`, this app's first real
 *   confirm-before-destroying dialog, and only on confirm runs `deleteDiagramAndRefresh`, which also
 *   removes the on-disk artifact).
 *
 * The two tabs are mutually exclusive, mirroring LlmSettingsPanel's own ad hoc `role="tablist"`
 * pattern (no shared Tabs component exists in this repo for just two tabs). The panel mounts
 * whenever any of agents/on-canvas is non-empty.
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
  const engineClient = useEngineClient();
  const agents = useAgents();
  const dockedAgentIds = useDockedAgentIds();
  const current = useCurrentBranch();
  const diagramsReady = useDiagramsReady();
  const doc = useCanvasDoc();
  const customTypes = useCustomDiagramTypes(engineClient);
  const collapsedLayers = useCollapsedLayers();
  const diagramLayers = useMemo(() => listActiveDiagramLayers(doc), [doc]);
  const tutorialActive = useTutorialActive();
  const sim = useTutorialSim();
  const simRows = tutorialActive ? tutorialAgentRows(sim) : [];
  const [tab, setTab] = useState<RailTab>(() => (agents.length > 0 ? "agents" : "diagrams"));
  const railResets = sim.railResets;
  useEffect(() => {
    if (railResets > 0) setTab("diagrams");
  }, [railResets]);
  const [deletingLayer, setDeletingLayer] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onToggleLayer = (layer: string) => {
    // A pure visibility toggle in both directions -- collapsing hides that layer's elements/edges
    // from CanvasDocView without deleting them, expanding shows them again. No recipe re-run here: a
    // refresh would shuffle the epics layer (re-layout) and show a transient "Refreshing…", which
    // reads as the diagram "twitching" on a plain expand click. Diagrams catch up with their on-disk
    // artifact on their own via DrawDiagramButton's readiness/fingerprint watcher.
    collapsedLayersStore.toggle(layer);
  };

  const confirmDelete = () => {
    if (!deletingLayer) return;
    const layer = deletingLayer;
    setDeleteBusy(true);
    setDeleteError(null);
    void deleteDiagramAndRefresh(engineClient, layer)
      .then((result) => {
        if (result.ok) setDeletingLayer(null);
        else setDeleteError(result.error);
      })
      .catch((err: unknown) => setDeleteError(err instanceof Error ? err.message : "delete failed"))
      .finally(() => setDeleteBusy(false));
  };

  return (
    <div className="agent-task-rail" data-testid="agent-task-rail" hidden={hidden}>
      <div className="agent-task-rail-tabs" role="tablist" aria-label="Agent panel sections">
        <button
          type="button"
          role="tab"
          className="agent-task-rail-tab"
          id="agent-task-rail-tab-agents"
          aria-selected={tab === "agents"}
          aria-controls="agent-task-rail-panel-agents"
          data-testid="agent-task-rail-tab-agents"
          onClick={() => setTab("agents")}
        >
          Agents
        </button>
        <button
          type="button"
          role="tab"
          className="agent-task-rail-tab"
          id="agent-task-rail-tab-diagrams"
          aria-selected={tab === "diagrams"}
          aria-controls="agent-task-rail-panel-diagrams"
          data-testid="agent-task-rail-tab-diagrams"
          onClick={() => setTab("diagrams")}
        >
          Diagrams
        </button>
      </div>
      {tab === "agents" ? (
        <div
          className="agent-task-rail-tabpanel"
          role="tabpanel"
          id="agent-task-rail-panel-agents"
          aria-labelledby="agent-task-rail-tab-agents"
        >
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
                      // where DrawDiagramButton's own watcher adds the diagram without further prompting.
                      agentStore.clearDiagramsReady(agent.id);
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
      ) : (
        <div
          className="agent-task-rail-tabpanel"
          role="tabpanel"
          id="agent-task-rail-panel-diagrams"
          aria-labelledby="agent-task-rail-tab-diagrams"
        >
          <div className="agent-task-rail-header">
            <span className="agent-task-rail-label">Diagrams</span>
            <span className="agent-task-rail-count">{diagramLayers.length}</span>
          </div>
          <div className="agent-task-rail-body">
            {diagramLayers.length === 0 ? (
              <p className="agent-task-rail-empty">
                No diagrams yet — click Draw… on the canvas rail to create one.
              </p>
            ) : (
              <>
                {diagramLayers.map((layer) => {
                  const collapsed = collapsedLayers.has(layer);
                  const label = labelForDiagramLayer(layer, customTypes, doc);
                  const statusSuffix = collapsed
                    ? "collapsed, click to expand"
                    : "expanded, click to collapse";
                  return (
                    <div className="agent-rail-row" key={layer}>
                      <RailButton
                        className="agent-rail-item"
                        testId={`diagram-rail-${layer}`}
                        label={`${label} — ${statusSuffix}`}
                        pressed={!collapsed}
                        onClick={() => onToggleLayer(layer)}
                      >
                        <span className="diagram-rail-chevron" aria-hidden="true">
                          {collapsed ? "▸" : "▾"}
                        </span>
                        <span className="agent-rail-preview">
                          <span className="agent-rail-title">{label}</span>
                        </span>
                      </RailButton>
                      {/* Not a `diagram-rail-*` test id on purpose: the tab's own tests count rows
                          with `getAllByTestId(/^diagram-rail-/)`, which this would join. */}
                      <button
                        type="button"
                        className="diagram-rail-delete"
                        aria-label={`Delete ${label}`}
                        data-testid={`diagram-delete-${layer}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeletingLayer(layer);
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
      {deletingLayer && (
        <DeleteDiagramDialog
          label={labelForDiagramLayer(deletingLayer, customTypes, doc)}
          note={
            deletingLayer.startsWith("custom/")
              ? "The saved diagram type itself is not affected."
              : undefined
          }
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => setDeletingLayer(null)}
          onConfirm={confirmDelete}
        />
      )}
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
