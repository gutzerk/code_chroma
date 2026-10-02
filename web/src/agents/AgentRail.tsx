import { useMemo, useState } from "react";
import { collectActiveLayers, useCanvasDoc } from "../canvas/doc/canvasDocStore";
import { collapsedLayersStore, useCollapsedLayers } from "../canvas/doc/collapsedLayersStore";
import {
  computeReadyDiagrams,
  deleteDiagramAndRefresh,
  isRecipeBackedLayer,
  labelForDiagramLayer,
  listActiveDiagramLayers,
  removeLayerAndRefresh,
  runRecipeAndLayout,
  useCustomDiagramTypes,
  useDiagramsStatus,
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

type RailTab = "agents" | "diagrams";

type LayerResult = { ok: true } | { ok: false; error: string };

/** One row-scoped async action (refresh/add/remove all share this exact shape): tracks which single
 * layer is busy and the last error, and clears the busy flag only if it's still this call's own
 * layer (a stale `finally` from a superseded action must not clear a newer one's busy state). */
function useLayerAction(fallbackError: string) {
  const [busyLayer, setBusyLayer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (layer: string, action: (layer: string) => Promise<LayerResult>) => {
    setError(null);
    setBusyLayer(layer);
    void action(layer)
      .then((result) => {
        if (!result.ok) setError(result.error);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : fallbackError))
      .finally(() => setBusyLayer((current) => (current === layer ? null : current)));
  };

  return { busyLayer, error, run };
}

/**
 * The agent task panel: a full-height dock beside the canvas, one card per agent for its whole
 * lifetime, and the only place a minimized window can be reopened from without a window of its own.
 * Minimizing does not remove its card, it only flips `aria-pressed` — so the panel answers "which
 * agents exist and which one wants me?" at a glance, without the list changing shape as windows come
 * and go.
 *
 * A second "Diagrams" tab shares this same dock and is now the *only* place a diagram is shown and
 * managed (016-single-canvas-dashboard Stage 4 originally split this with `RecipeMenu`'s dropdown;
 * the diagram-management unification retired that dropdown down to a plain "Draw…" button — see
 * `DrawDiagramButton.tsx` — and moved everything else here). Two sections:
 *
 * - **On canvas** — one row per diagram layer currently placed (`listActiveDiagramLayers`). Clicking
 *   a row toggles `collapsedLayersStore` rather than opening a window — collapsed hides that
 *   diagram's elements/edges from CanvasDocView without deleting them, expanded shows them again.
 *   Expanding is also a manual refresh trigger: it re-runs that layer's recipe
 *   (`runRecipeAndLayout`), so a diagram an agent edited while this browser tab was closed or
 *   backgrounded catches up the moment it's shown again, without waiting for the next WS ping or
 *   reload. Collapsing never refreshes — there's nothing to show yet. Each row also carries a
 *   "remove from canvas" button (soft — `removeLayerAndRefresh`, keeps the underlying artifact so it
 *   reappears in "Available to add" below and can come straight back with no redraw) and a delete
 *   button (hard — opens `DeleteDiagramDialog`, this app's first real confirm-before-destroying
 *   dialog, and only on confirm runs `deleteDiagramAndRefresh`, which also removes the on-disk
 *   artifact).
 * - **Available to add** — every built-in/custom diagram whose artifact is generated but not
 *   currently placed (`computeReadyDiagrams`, the same readiness split `DrawDiagramButton` computes
 *   for its own task prompt — kept as an accepted duplication, same as `useCustomDiagramTypes`
 *   below). Clicking a row calls `runRecipeAndLayout` to place it back, restoring its last dragged
 *   position via `layerPositionCache` rather than a fresh layout.
 *
 * The two tabs are mutually exclusive, mirroring LlmSettingsPanel's own ad hoc `role="tablist"`
 * pattern (no shared Tabs component exists in this repo for just two tabs). The panel mounts
 * whenever any of agents/on-canvas/available-to-add is non-empty.
 *
 * `refresh`/`add`/`remove` (each a `useLayerAction()` instance below — one row-scoped busy flag plus
 * a last-error, the shape all three row actions share) disable a row's own button while its action
 * is in flight and surface a hard failure inline, since this tab has no other error slot.
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
export function AgentRail() {
  const agentClient = useAgentClient();
  const engineClient = useEngineClient();
  const agents = useAgents();
  const current = useCurrentBranch();
  const diagramsReady = useDiagramsReady();
  const doc = useCanvasDoc();
  const customTypes = useCustomDiagramTypes(engineClient);
  const diagramsStatus = useDiagramsStatus(engineClient);
  const collapsedLayers = useCollapsedLayers();
  const diagramLayers = useMemo(() => listActiveDiagramLayers(doc), [doc]);
  const activeLayers = useMemo(() => collectActiveLayers(doc), [doc]);
  const readyDiagrams = useMemo(
    () => computeReadyDiagrams(diagramsStatus, customTypes, activeLayers),
    [diagramsStatus, customTypes, activeLayers],
  );
  const availableDiagrams = useMemo(() => {
    const builtins = readyDiagrams.readyBuiltins
      .filter((recipe) => !activeLayers.has(recipe.name))
      .map((recipe) => ({ name: recipe.name, label: recipe.label }));
    const custom = readyDiagrams.readyCustomTypes
      .filter((type) => !activeLayers.has(`custom/${type.id}`))
      .map((type) => ({ name: `custom/${type.id}`, label: type.title }));
    return [...builtins, ...custom];
  }, [readyDiagrams, activeLayers]);
  const [tab, setTab] = useState<RailTab>(() => (agents.length > 0 ? "agents" : "diagrams"));
  const refresh = useLayerAction("refresh failed");
  const add = useLayerAction("add failed");
  const remove = useLayerAction("remove failed");
  const [deletingLayer, setDeletingLayer] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onAddLayer = (layer: string) => add.run(layer, (l) => runRecipeAndLayout(engineClient, l));

  const onRemoveLayer = (layer: string) =>
    remove.run(layer, (l) => removeLayerAndRefresh(engineClient, l));

  const onToggleLayer = (layer: string, wasCollapsed: boolean) => {
    collapsedLayersStore.toggle(layer);
    if (!wasCollapsed) return; // was already expanded -> this click collapses it, nothing to refresh
    // A one-off layer a skill/agent PATCHed directly onto the canvas (see listActiveDiagramLayers)
    // has no backing recipe to reconcile against -- runRecipeAndLayout would just 404. Expanding it
    // is a pure visibility toggle in that case; collapsedLayersStore.toggle above already did it.
    if (!isRecipeBackedLayer(layer)) return;
    refresh.run(layer, (l) => runRecipeAndLayout(engineClient, l));
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

  if (agents.length === 0 && diagramLayers.length === 0 && availableDiagrams.length === 0) return null;

  return (
    <div className="agent-task-rail" data-testid="agent-task-rail">
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
            <span className="agent-task-rail-count">{agents.length}</span>
          </div>
          <div className="agent-task-rail-body">
            {agents.map((agent) => {
              const onBranch = isAgentOnBranch(agent, current);
              const hasDiagram = diagramsReady.has(agent.id);
              return (
                <div className="agent-rail-row" key={agent.id}>
                  <RailButton
                    className={`agent-rail-item${onBranch ? "" : " agent-rail-item-off-branch"}`}
                    testId={`agent-rail-${agent.id}`}
                    label={tooltipFor(agent, onBranch, hasDiagram)}
                    pressed={!agent.window.minimized}
                    onClick={() => {
                      // Clicking is the acknowledgement: restoring also activates that workspace,
                      // where DrawDiagramButton's own watcher adds the diagram without further prompting.
                      agentStore.clearDiagramsReady(agent.id);
                      if (agent.window.minimized) restoreAgentWindow(agentClient, agent.id);
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
            {diagramLayers.length === 0 && availableDiagrams.length === 0 ? (
              <p className="agent-task-rail-empty">
                No diagrams yet — click Draw… on the canvas rail to create one.
              </p>
            ) : (
              <>
                {diagramLayers.map((layer) => {
                  const collapsed = collapsedLayers.has(layer);
                  const refreshing = refresh.busyLayer === layer;
                  const removing = remove.busyLayer === layer;
                  const label = labelForDiagramLayer(layer, customTypes);
                  const statusSuffix = refreshing
                    ? "refreshing…"
                    : collapsed
                      ? "collapsed, click to expand"
                      : "expanded, click to collapse";
                  return (
                    <div className="agent-rail-row" key={layer}>
                      <RailButton
                        className="agent-rail-item"
                        testId={`diagram-rail-${layer}`}
                        label={`${label} — ${statusSuffix}`}
                        pressed={!collapsed}
                        disabled={refreshing || removing}
                        onClick={() => onToggleLayer(layer, collapsed)}
                      >
                        <span className="diagram-rail-chevron" aria-hidden="true">
                          {collapsed ? "▸" : "▾"}
                        </span>
                        <span className="agent-rail-preview">
                          <span className="agent-rail-title">{label}</span>
                          {refreshing && <span className="agent-rail-status">Refreshing…</span>}
                        </span>
                      </RailButton>
                      {/* Not a `diagram-rail-*` test id on purpose: the tab's own tests count rows
                          with `getAllByTestId(/^diagram-rail-/)`, which this would join. */}
                      <button
                        type="button"
                        className="diagram-rail-remove"
                        aria-label={`Remove ${label} from canvas`}
                        data-testid={`diagram-remove-${layer}`}
                        disabled={refreshing || removing}
                        onClick={() => onRemoveLayer(layer)}
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        className="diagram-rail-delete"
                        aria-label={`Delete ${label}`}
                        data-testid={`diagram-delete-${layer}`}
                        disabled={refreshing || removing}
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
                {refresh.error && (
                  <p className="agent-task-rail-empty" data-testid="diagram-rail-error">
                    {refresh.error}
                  </p>
                )}
                {remove.error && (
                  <p className="agent-task-rail-empty" data-testid="diagram-rail-remove-error">
                    {remove.error}
                  </p>
                )}
                {availableDiagrams.length > 0 && (
                  <div className="agent-task-rail-section">
                    <div className="agent-task-rail-subheader">Available to add</div>
                    {availableDiagrams.map(({ name, label }) => {
                      const adding = add.busyLayer === name;
                      return (
                        <div className="agent-rail-row" key={`available-${name}`}>
                          <RailButton
                            className="agent-rail-item"
                            testId={`diagram-add-${name}`}
                            label={`Add ${label} to the canvas`}
                            disabled={adding}
                            onClick={() => onAddLayer(name)}
                          >
                            <span className="diagram-rail-chevron" aria-hidden="true">
                              +
                            </span>
                            <span className="agent-rail-preview">
                              <span className="agent-rail-title">{label}</span>
                              {adding && <span className="agent-rail-status">Adding…</span>}
                            </span>
                          </RailButton>
                        </div>
                      );
                    })}
                    {add.error && (
                      <p className="agent-task-rail-empty" data-testid="diagram-rail-add-error">
                        {add.error}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {deletingLayer && (
        <DeleteDiagramDialog
          label={labelForDiagramLayer(deletingLayer, customTypes)}
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
