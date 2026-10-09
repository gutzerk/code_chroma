import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ROOT_NODE_ID, type HierarchyNodeRef, type LayoutKind } from "../state/types";
import { reportAsyncError } from "../util/reportError";
import { UndoManager } from "./UndoManager";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { ConnectionsOverlay } from "./ConnectionsOverlay";
import { ChangeConnectionsOverlay } from "./ChangeConnectionsOverlay";
import { TraceFlowOverlay } from "./TraceFlowOverlay";
import { RouteProbeOverlay } from "./RouteProbeOverlay";
import { RouteProbeTrigger } from "./RouteProbeTrigger";
import { LabelClearanceMonitor } from "./LabelClearanceMonitor";
import { TraceControls } from "./TraceControls";
import { CanvasViewport, type CanvasViewportHandle } from "./CanvasViewport";
import { readSavedCameraView } from "./canvasCameraStore";
import { CanvasFocusContext } from "./CanvasFocusContext";
import { CanvasDocView } from "./doc/CanvasDocView";
import { DiagramHealthNote } from "./doc/DiagramHealthNote";
import { SidecarSummaryCard } from "./doc/SidecarSummaryCard";
import { WikiGeneralNotice } from "./WikiGeneralNotice";
import { EpicBriefPanel } from "./doc/EpicBriefPanel";
import { DescriptionPopup } from "./doc/DescriptionPopup";
import { DrawDiagramButton } from "./doc/DrawDiagramButton";
import { GamesMenu } from "../games/GamesMenu";
import { useHasCanvasLayer } from "./doc/canvasDocStore";
import { CodePopupContext } from "./CodePopupContext";
import { CodePopup } from "./CodePopup";
import { InspectorPanel } from "./InspectorPanel";
import { inspectorStore, useIsInspectorOpen } from "./inspectorStore";
import { ProjectTreePanel } from "./ProjectTreePanel";
import { CodeSidebar } from "./CodeSidebar";
import { TutorialAgentMock } from "../tutorial/TutorialAgentMock";
import { TutorialChat } from "../tutorial/TutorialChat";
import { tutorialSimStore } from "../tutorial/tutorialSim";
import { tutorialStore } from "../tutorial/tutorialStore";
import { useStartTutorial } from "../tutorial/useStartTutorial";
import {
  projectTreePanelStore,
  useIsProjectTreePanelOpen,
} from "./projectTreePanelStore";
import { useLatchedMount } from "./panelStore";
import { RailIcon } from "../icons/RailIcon";
import runAgentIcon from "../icons/run-agent.svg";
import { RailButton } from "./RailButton";
import { SplitterHandle } from "./SplitterHandle";
import { AgentLedStrip } from "../agents/AgentLedStrip";
import { AgentRail } from "../agents/AgentRail";
import { AgentTerminalDock } from "../agents/AgentTerminalDock";
import { AgentWindowLayer } from "../agents/AgentWindowLayer";
import {
  useActiveWorkspace,
  useAgents,
  useIsAtAgentCapacity,
  useIsLaunchingAgent,
  useMaxAgents,
} from "../agents/agentStore";
import { useAgentClient } from "../agents/AgentClientContext";
import { attachAgent } from "../agents/attachAgent";
import { BranchSwitcher } from "../agents/BranchSwitcher";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { terminalPanelStore, useIsTerminalPanelOpen } from "../terminal/terminalPanelStore";
import { useIsDiffActive } from "../state/diffOverlayStore";
import { PrRailButton } from "../pr/PrRailButton";
import { usePrWorkspaces } from "../pr/prStore";
import { SettingsRailButton } from "../assistant/SettingsRailButton";
import { ReportIssueRailButton } from "../assistant/ReportIssueRailButton";
import { traceStore, useTraceState } from "../state/traceStore";
import { revealNode } from "../state/revealNode";
import { autoExpandInitial } from "../state/autoExpandInitial";
import { liveStore, useLiveVersion } from "../state/liveStore";
import { viewContextStore, useCurrentViewContext } from "../state/viewContextStore";
import { buildViewContext } from "../agents/viewContext";
import { DeletedDiffOverlay } from "./DeletedDiffOverlay";
import { ImpactChangeSummary } from "./ImpactChangeSummary";
import { useImpactChangesSidecar, useImpactDiffSync } from "../state/useSidecar";
import { useSkillOutput } from "../state/useSkillOutput";
import { useIsWorkspaceReadOnly } from "../agents/workspaceStore";
import {
  expansionStore,
  useCodeVisibleNodeIdsByOrder,
  useDeepestExpandedPath,
  useExpandedNodeIdsByOrder,
} from "../state/expansionState";
import { useCanvasCamera } from "./useCanvasCamera";
import { useDiffToggle } from "./useDiffToggle";

// How many rAF retries the initial camera-recenter gets before giving up (see the effect below) --
// exported so e2e specs waiting this settle out can reference the real cap instead of a magic number.
// ~3s at 60fps: since 016-single-canvas-dashboard the centered element is a HierarchyElement pinned
// onto the canvas doc, which only mounts once its own async chain (canvas-doc load -> seed
// add_element -> its own getNode fetch) resolves -- a handful of frames used to be enough when the
// root row mounted synchronously with `rootNode`, but now the first several calls can all fire
// before the element exists at all, same reasoning as useCanvasCamera's FIT_MAX_FRAMES.
export const CAMERA_RECENTER_MAX_FRAMES = 180;
// Every layout kind with boxes actually draggable on the one canvas today -- "hierarchy" (the
// pinned root row, still saved-layout-based) and "canvas" (every CanvasNodeBox drag). A module-level
// constant, not built inline in JSX, so UndoManager's own effect (deps [kinds]) doesn't re-subscribe
// its keydown listener on every RootCanvas render.
const UNDO_KINDS: readonly LayoutKind[] = ["hierarchy", "canvas"];

/** Mounts the root Block for the default repository (FR-002) — there is exactly one page, no
 * per-node URL (FR-018). */
export function RootCanvas() {
  const engineClient = useEngineClient();
  const [rootNode, setRootNode] = useState<HierarchyNodeRef | null>(null);
  const [codePopupNode, setCodePopupNode] = useState<HierarchyNodeRef | null>(null);
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(true);
  const allAgents = useAgents();
  const breadcrumbPath = useDeepestExpandedPath();
  const expandedNodeIds = useExpandedNodeIdsByOrder();
  const codeVisibleNodeIds = useCodeVisibleNodeIdsByOrder();
  const isTerminalPanelOpen = useIsTerminalPanelOpen();
  const agentClient = useAgentClient();
  const workspaceId = useActiveWorkspace();
  const prWorkspaces = usePrWorkspaces();
  // What to show in the chrome instead of the old node-path breadcrumb: the PR this workspace
  // reviews, if any -- BranchSwitcher already covers "which branch" for the main workspace, but it
  // always reflects main's own checked-out branch, never a PR's, so a PR workspace needs its own
  // identity label here.
  const activePr = useMemo(
    () => prWorkspaces.find((pr) => pr.id === workspaceId) ?? null,
    [prWorkspaces, workspaceId],
  );
  const viewContext = useCurrentViewContext();
  const isAtAgentCapacity = useIsAtAgentCapacity();
  const isLaunchingAgent = useIsLaunchingAgent();
  const maxAgents = useMaxAgents();
  const isInspectorOpen = useIsInspectorOpen();
  const isProjectTreePanelOpen = useIsProjectTreePanelOpen();
  // Latched: each panel stays mounted (hidden via CSS) after its first open, so PTY scrollback
  // and a dragged panel width survive close/reopen.
  const terminalMounted = useLatchedMount(isTerminalPanelOpen);
  const inspectorMounted = useLatchedMount(isInspectorOpen);
  const projectTreeMounted = useLatchedMount(isProjectTreePanelOpen);
  useStartTutorial(rootNode?.name ?? null);
  const isDiffActive = useIsDiffActive();
  const isReadOnly = useIsWorkspaceReadOnly();
  // The "impact" recipe's layer is the one-canvas model's replacement for the old "view is open"
  // flag (AgentRail's Diagrams tab is the one place a diagram gets added/removed now -- see
  // diagramCatalog.ts). This only
  // gates the *floating summary panel* below, not useImpactChangesSidecar's `enabled` --
  // impactChangesSidecarStore (which the hook populates) drives diff badges on every hierarchy/Impact
  // block unconditionally (see single-canvas.md), so disabling the fetch here would silently kill
  // hierarchy diff badges for anyone who hasn't added the Impact diagram to their canvas.
  const hasImpactLayer = useHasCanvasLayer("impact");
  // Always-on diff + status data for the Impact layer: its blocks show diffs and color their
  // file/function lists by status even with the global Diff toggle off (see useSidecar.ts). Gated
  // on the impact layer's presence, like useImpactChangesSidecar's review fetch below — with no
  // impact layer there's nothing to annotate, so the deterministic diff/status GETs stay idle.
  useImpactDiffSync(engineClient, hasImpactLayer);
  const impactReview = useImpactChangesSidecar(engineClient, isDiffActive, !isReadOnly);
  const impactReviewOutput = useSkillOutput(engineClient, "impact-changes", impactReview.state);
  const traceState = useTraceState();
  const isTraceActive = traceState.isActive;
  const liveVersion = useLiveVersion();
  const viewportRef = useRef<CanvasViewportHandle | null>(null);
  // Seed the count-change auto-fit baselines from the RESTORED expansion: when the store comes
  // back with N expanded/CV nodes already mounted (a reload restoring persisted state), the first
  // render sees length 0->N and would otherwise trigger the "expansion/code count changed" auto-fit
  // on every restored block — drifting the camera off the saved position by one frame-fit on each
  // reload. Initializing the refs to the restored counts makes that transition a no-op. Reads the
  // snapshot directly (not the hook), so it's the same value the very first render will see.
  const previousExpandedCountRef = useRef(expansionStore.getExpandedNodeIdsByOrder().length);
  // Guards the first-load auto-expand so live re-renders / reconnects never re-trigger it (and never
  // fight a user's manual collapses).
  const autoExpandDoneRef = useRef(false);
  const previousCodeVisibleCountRef = useRef(expansionStore.getCodeVisibleNodeIdsByOrder().length);
  // Latest codePopupNode, read by the live-refresh effect without depending on it (getNode returns
  // a fresh object each call, so a dep would loop: refetch → setState → refetch).
  const codePopupNodeRef = useRef<HierarchyNodeRef | null>(null);
  codePopupNodeRef.current = codePopupNode;
  // The camera policy — retry-until-mounted framing plus the auto-fit suppression lock.
  const camera = useCanvasCamera(viewportRef);
  const { frameFitTo } = camera;

  // Read once at startup only, never during interaction: these pick initial state, they are not
  // deep-linking or per-node routing, which FR-018 explicitly drops. The app never writes them.
  const params = new URLSearchParams(window.location.search);
  // Which fixture to load at initial page load.
  const rootNodeId = params.get("root") ?? ROOT_NODE_ID;
  // First-load auto-expand is on by default; `?autoexpand=off` disables it (used by e2e specs that
  // drive manual expand/collapse from a known-collapsed start).
  const autoExpandEnabled = params.get("autoexpand") !== "off";

  useEffect(() => {
    let cancelled = false;
    engineClient
      .getNode(rootNodeId)
      .then((node) => {
        if (!cancelled) {
          setRootNode(node);
          if (node) expansionStore.cacheNodeRefs([node]);
        }
      })
      // The live-ping effects don't retry this root fetch, so a failure here used to mean a blank
      // canvas forever with an unhandled rejection; at least make it loud.
      .catch((cause: unknown) => reportAsyncError(`root node ${rootNodeId} fetch`, cause));
    return () => {
      cancelled = true;
    };
  }, [engineClient, rootNodeId]);

  // First load: auto-expand the tree downward until >= 5 elements are visible (cascading whole
  // levels), so the canvas opens on a useful view instead of a single collapsed root. Runs once
  // (autoExpandDoneRef), suppressing the per-expand count-change auto-fit during the batch so the
  // camera doesn't chase each expand, then frames the whole revealed set once at the end.
  useEffect(() => {
    if (!rootNode || autoExpandDoneRef.current) return;
    autoExpandDoneRef.current = true;
    // Read the restored-camera flag deterministically from the store rather than through
    // viewportRef.current: this effect can run BEFORE the viewport's imperative handle is mounted
    // (the handle registers in its own render/effect), in which case `viewportRef.current` is null
    // and hasRestoredView() reads false — making a restored camera look like a fresh origin and
    // spuriously re-running auto-expand/fit, which drifts the view sideways on every reload.
    const restoredView = readSavedCameraView() !== null;
    const restoredExpansion = expansionStore.hasRestoredExpansion();
    const id = rootNode.node_id;

    // A full return-to-place: BOTH the persisted camera and the persisted tree expansion were
    // restored, so the canvas is exactly where the user left it — re-running auto-expand would
    // re-layout the already-restored tree (shifting it off the saved camera), and re-framing would
    // snap off the saved position. Neither should run.
    if (restoredView && restoredExpansion) return;

    // Retries until centerOnNode actually finds and centers the element, not just a fixed number
    // of blind calls -- the boxes strategy also needs a frame or two for its later top-level boxes'
    // x position to settle (useMeasuredSizes' ResizeObserver, async relative to rAF), on top of the
    // mount race documented on CAMERA_RECENTER_MAX_FRAMES above. Stopping the instant it succeeds
    // (rather than always spending the full cap) keeps this from fighting a quick user gesture, e.g.
    // toggling Diff right after a workspace switch remounts this effect.
    let frame = 0;
    let cancelled = false;
    const recenter = () => {
      if (cancelled) return;
      const centered = viewportRef.current?.centerOnNode(id) ?? false;
      frame += 1;
      if (!centered && frame < CAMERA_RECENTER_MAX_FRAMES) requestAnimationFrame(recenter);
    };

    // A workspace switch onto a restored tree with no saved camera (e.g. its camera was cleared or
    // is at the reset origin), or a tree with auto-expand disabled: the expansion is already in its
    // saved state, so no auto-expand — just center the root on the blank view.
    if (restoredExpansion || !autoExpandEnabled) {
      requestAnimationFrame(recenter);
      return () => {
        cancelled = true;
      };
    }

    camera.suppress();
    autoExpandInitial(rootNode, engineClient)
      .then((revealedIds) => {
        // A restored camera keeps the user's spot; otherwise fit to the whole revealed set, not just
        // root — root's rect is still the bare header until its descendants paint.
        if (restoredView) {
          // frameFitTo (below) is what releases the suppress() taken above once it finishes framing;
          // with a restored camera there is no frame to run, so release the lock by hand — otherwise
          // every later manual expand/collapse would be wrongly frozen out of auto-fitting.
          camera.release();
          return;
        }
        frameFitTo(revealedIds.length > 0 ? revealedIds : [id]);
      })
      .catch((cause: unknown) => {
        // Still frame the root: a half-failed auto-expand must not leave the camera suppressed.
        reportAsyncError("initial auto-expand", cause);
        if (restoredView) camera.release();
        else frameFitTo([id]);
      });
  }, [rootNode, engineClient, autoExpandEnabled, frameFitTo, camera]);

  // View-agnostic on purpose: the C1 view renders no root block, so targeting rootNode here was a
  // silent no-op there. fitToAllNodes unions whatever is actually mounted in either view.
  const fitAll = useCallback(() => viewportRef.current?.fitToAllNodes(), []);
  useEffect(() => {
    tutorialSimStore.setFitAll(fitAll);
    return () => tutorialSimStore.setFitAll(null);
  }, [fitAll]);
  useEffect(() => {
    tutorialSimStore.setFitSelector((selector) => viewportRef.current?.fitToSelector(selector) ?? false);
    return () => tutorialSimStore.setFitSelector(null);
  }, []);

  // A click on a row in the ProjectTree sidebar: reveal the node's ancestors (expand the canvas
  // tree down to it) then frame the block once it's mounted. navigateTreeTo is the concrete "focus
  // the canvas on this node" the panel calls on every activation. It frames via camera.frameFitTo
  // (not a single rAF) because each revealed ancestor's children mount asynchronously — a deeply
  // nested target needs several fetches, so one frame can fire before the block exists; frameFitTo
  // retries until the block mounts (bounded by FIT_MAX_FRAMES), the same mechanism the initial
  // auto-expand and diff reveals use.
  const navigateTreeTo = useCallback(
    (nodeId: string) => {
      void revealNode(nodeId, engineClient).then(() => {
        camera.frameFitTo([nodeId]);
      });
    },
    [engineClient, camera],
  );

  // Reports a base "current view" context so the agent-launch buttons always have something to hand
  // the fresh agent. Kept out of the render path (an effect) so reporting never re-renders the tree.
  useEffect(() => {
    viewContextStore.set(
      buildViewContext({
        workspace: workspaceId,
        view: "hierarchy",
        breadcrumb: breadcrumbPath,
      }),
    );
  }, [workspaceId, breadcrumbPath]);

  // Bridge live pings drive one shared version counter; the effects below re-fetch off it.
  useEffect(() => engineClient.subscribe(liveStore.bump), [engineClient]);

  // A live tracer (codechroma-trace --stream) drives the same overlay off the socket instead of a
  // fetched trace: trace-start opens a live run, each step appends and advances, trace-end re-enables
  // scrubbing. The canvas auto-enters trace mode when a run begins so "see it in real time" works
  // without a manual toggle.
  useEffect(
    () =>
      engineClient.subscribeTraceStream((message) => {
        if (message.type === "trace-start") {
          traceStore.startLive(message.trace_id, message.entry ?? "");
        } else if (message.type === "step") {
          traceStore.ensureLive(message.trace_id);
          traceStore.appendStep(message.step);
        } else if (message.type === "trace-end") {
          traceStore.endLive(message.status);
        }
      }),
    [engineClient],
  );

  // As the active step advances, follow it: reveal the frame's block (drilling into functions when
  // Follow is on — same nearest-visible-ancestor logic the overlay draws with) and pan the camera
  // onto it without changing zoom. With Follow off, nothing is revealed, so the overlay routes flow
  // between whatever blocks are currently open.
  const activeTraceNodeId = traceState.currentFrame?.node_id ?? null;
  const traceFollowCamera = traceState.followCamera;
  useEffect(() => {
    if (!isTraceActive || !traceFollowCamera || !activeTraceNodeId) return;
    let cancelled = false;
    void revealNode(activeTraceNodeId, engineClient).then(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        const visible =
          expansionStore.getNearestVisibleAncestor(activeTraceNodeId) ?? activeTraceNodeId;
        viewportRef.current?.centerOnNode(visible);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isTraceActive, traceFollowCamera, activeTraceNodeId, engineClient]);

  // A live update must never move the camera (the user is looking at their own edit in place), so
  // hold the auto-fit suppression flag for a beat around every bump — long enough to cover the
  // async re-fetch/reconcile that follows it, released 1.2s after the last change.
  useEffect(() => {
    if (liveVersion === 0) return;
    camera.suppress();
    const timer = setTimeout(() => {
      camera.release();
    }, 1200);
    return () => clearTimeout(timer);
  }, [liveVersion, camera]);

  // Keep an open code popup in sync with disk: refresh its source in place, or close it if the node
  // was deleted (normal mode removes it quietly; diff mode shows the deletion in DeletedDiffOverlay).
  useEffect(() => {
    if (liveVersion === 0) return;
    const current = codePopupNodeRef.current;
    if (!current) return;
    let cancelled = false;
    engineClient.getNode(current.node_id).then((node) => {
      if (!cancelled) setCodePopupNode(node);
    });
    return () => {
      cancelled = true;
    };
  }, [liveVersion, engineClient]);

  // The Diff toggle button is hidden from the rail for now (logic kept, not deleted, so it's
  // easy to re-enable) — the hook still runs for its reconciler side effects.
  useDiffToggle({
    engineClient,
    rootNode,
    camera,
    liveVersion,
    isDiffActive,
  });

  // Expanding or collapsing a block changes the visible tree's extent, so auto-focus the camera
  // either way — but onto the block that changed, not the whole root, so expanding a deeply
  // nested block locks the screen onto just that block instead of re-fitting everything. On
  // expand this is the newly expanded node (the deepest entry in expandedOrder); on collapse it's
  // whatever is now the new deepest expanded node, falling back to the root once nothing is
  // expanded. Gated on an actual count change (not just identity changes when rootNode first
  // loads) so it doesn't fight the initial center-on-load.
  useEffect(() => {
    // While a diff reveal/restore is framing the camera itself (toggleDiff's fitToNodes/fitToNode),
    // skip the single-node auto-fit so it can't override that framing — but still keep the count
    // ref current so the next real expand/collapse fits correctly. Trace mode does its own follow
    // framing (revealing each frame's block), so it suppresses this the whole time it's on.
    if (
      !camera.isSuppressed() &&
      !isTraceActive &&
      // On a restore the whole tree is present before first render, so a transient 0->N count jump
      // (previousExpandedCountRef seeded from 0 until the restored snapshot lands) must not trigger
      // a re-fit that slides the camera off the saved position.
      !expansionStore.hasRestoredExpansion() &&
      expandedNodeIds.length !== previousExpandedCountRef.current
    ) {
      const targetId = expandedNodeIds[expandedNodeIds.length - 1] ?? rootNode?.node_id;
      if (targetId) requestAnimationFrame(() => camera.fitToNode(targetId));
    }
    previousExpandedCountRef.current = expandedNodeIds.length;
  }, [expandedNodeIds, rootNode, isTraceActive, camera]);

  // Showing a block's inline code panel (block-code-open) can grow it well past the current
  // viewport/zoom, so re-fit the camera onto whichever node's code was most recently shown —
  // covers both the inline-toggle path (Block.tsx's expansionStore.toggleCode) and the
  // diff-reveal path (useDiffToggle), since both go through showCode/toggleCode. Hiding code
  // (count decreases) intentionally leaves the camera alone — there's no sensible re-fit target.
  useEffect(() => {
    // Suppressed during a diff reveal/restore for the same reason as the expand effect above —
    // useDiffToggle frames the whole changed set (or the root) explicitly. Same camera exclusion.
    if (
      !camera.isSuppressed() &&
      !isTraceActive &&
      codeVisibleNodeIds.length !== previousCodeVisibleCountRef.current
    ) {
      const targetId = codeVisibleNodeIds[codeVisibleNodeIds.length - 1];
      if (targetId) requestAnimationFrame(() => camera.fitToNode(targetId));
    }
    previousCodeVisibleCountRef.current = codeVisibleNodeIds.length;
  }, [codeVisibleNodeIds, isTraceActive, camera]);

  return (
    <div className="app-root" data-testid="app-root">
      <UndoManager kinds={UNDO_KINDS} />
      {/* Row 1 of the floating-card shell: a full-width top bar above the rail, so the branch chip
          sits at the window's true left edge and Run agent at its true right edge, instead of being
          scoped to the canvas area beside the rail. */}
      <div className="canvas-chrome" data-testid="app-chrome">
        {activePr && (
          <span className="canvas-chrome-workspace-label" data-testid="active-pr-label">
            {`PR #${activePr.number} · ${activePr.head_ref}`}
          </span>
        )}
        <BranchSwitcher />
        <div className="canvas-chrome-spacer" />
        <ReportIssueRailButton />
        <GamesMenu />
        <div className="canvas-chrome-separator" />
        <PrRailButton />
        <SettingsRailButton />
        <RailButton
          className="agents-toggle-button"
          label="Run agent"
          disabled={isAtAgentCapacity || isLaunchingAgent}
          tooltip={
            isAtAgentCapacity
              ? `${maxAgents} agents is the limit — close one to start another`
              : "Attaches to the workspace you're currently viewing"
          }
          onClick={() => {
            // The lesson's second agent is a simulation; it never reaches the bridge.
            if (tutorialStore.isActive()) tutorialSimStore.startAgent2();
            else void attachAgent(agentClient, viewContext);
          }}
        >
          <img className="agents-toggle-icon" src={runAgentIcon} alt="" aria-hidden="true" />
          <span className="agents-toggle-label">Run agent</span>
        </RailButton>
      </div>
      <div className="app-body" data-testid="app-body">
        <nav className="app-rail" data-testid="app-rail" aria-label="View controls">
          <RailButton label="Zoom out" onClick={() => viewportRef.current?.zoomOut()}>
            −
          </RailButton>
          <RailButton
            label="Reset zoom"
            onClick={() => {
              viewportRef.current?.resetView();
              if (rootNode) {
                const id = rootNode.node_id;
                requestAnimationFrame(() => viewportRef.current?.centerOnNode(id));
              }
            }}
          >
            ⊙
          </RailButton>
          <RailButton label="Zoom in" onClick={() => viewportRef.current?.zoomIn()}>
            +
          </RailButton>
          <div className="app-rail-separator" />
          <RailButton
            className="terminal-toggle-button"
            label={isTerminalPanelOpen ? "Close terminal panel" : "Open terminal panel"}
            pressed={isTerminalPanelOpen}
            onClick={terminalPanelStore.toggle}
          >
            <RailIcon name="terminal" />
          </RailButton>
          <RailButton
            className="project-tree-toggle-button"
            label={isProjectTreePanelOpen ? "Close project tree panel" : "Open project tree panel"}
            pressed={isProjectTreePanelOpen}
            onClick={projectTreePanelStore.toggle}
          >
            <RailIcon name="hierarchy" />
          </RailButton>
          {/* Diff / AI-plan / Replay rail buttons hidden for now; underlying logic kept above. */}
          <DrawDiagramButton />
        </nav>
        <TutorialChat />
        <TutorialAgentMock />
        <div className="canvas-area" data-testid="canvas-area">
          {/* Row for the canvas plus the agent task panel beside it — a full-height sibling of the
              canvas, not a toolbar item, so cards have room to be more than an icon and a tooltip.
              The project tree stays the leftmost item (the very edge, right after .app-rail), with
              the code sidebar beside it and the docked agent windows to their right. */}
          <div className="canvas-main-row">
            {projectTreeMounted && rootNode && (
              <ProjectTreePanel
                rootNode={rootNode}
                hidden={!isProjectTreePanelOpen}
                onActivate={navigateTreeTo}
              />
            )}
            <CodeSidebar hidden={!isProjectTreePanelOpen} />
            <AgentTerminalDock />
            {/* Own positioning context so the absolutely-positioned overlays below keep anchoring to
                the visible canvas, not to the canvas plus the breadcrumb strip above it. */}
            <div className="canvas-stage">
              <CanvasViewport ref={viewportRef}>
                <CanvasFocusContext.Provider
                  value={(nodeId) => viewportRef.current?.focusOnNode(nodeId)}
                >
                  <CodePopupContext.Provider value={setCodePopupNode}>
                    <CanvasDocView />
                  </CodePopupContext.Provider>
                </CanvasFocusContext.Provider>
                {rootNode && <ConnectionsOverlay />}
                {rootNode && isDiffActive && <ChangeConnectionsOverlay />}
                {rootNode && isTraceActive && <TraceFlowOverlay />}
                {rootNode && <RouteProbeOverlay />}
                {rootNode && <LabelClearanceMonitor />}
                {/* Inside .canvas-content on purpose (unlike SidecarSummaryCard below, which is
                    deliberately screen-fixed chrome): a big PR's change list
                    should pan and zoom with the diagram it's annotating, same as any block. */}
                {isDiffActive && hasImpactLayer && (
                  <ImpactChangeSummary
                    review={impactReview}
                    outputLines={impactReviewOutput}
                    canGenerate={!isReadOnly}
                  />
                )}
              </CanvasViewport>
              <button
                type="button"
                className="fit-all-button"
                aria-label="Fit all open blocks"
                onClick={fitAll}
              >
                Fit All
              </button>
              {rootNode && <RouteProbeTrigger />}
              <SidecarSummaryCard />
              <DiagramHealthNote />
              <WikiGeneralNotice />
              {isDiffActive && <DeletedDiffOverlay />}
              {isTraceActive && <TraceControls />}
            </div>
            {/* Always rendered (unlike AgentRail itself, which fully hides): this is the only
                remaining way to re-expand the panel once collapsed, since collapsing now hides
                AgentRail entirely rather than shrinking it to a visible strip. */}
            <SplitterHandle
              className="agent-task-rail-resize-handle"
              dataTestid="agent-panel-toggle-handle"
              collapsed={!isAgentPanelOpen}
              onToggle={() => {
                if (isAgentPanelOpen) {
                  setCodePopupNode(null);
                  inspectorStore.close();
                }
                setIsAgentPanelOpen(!isAgentPanelOpen);
              }}
              ariaLabel={`${isAgentPanelOpen ? "Collapse" : "Expand"} agents and diagrams panel`}
              arrow={isAgentPanelOpen ? "›" : "‹"}
            />
            {!isAgentPanelOpen && (
              <AgentLedStrip
                framed
                agents={allAgents}
                testId="agent-rail-led"
                onSelect={() => setIsAgentPanelOpen(true)}
              />
            )}
            <AgentRail hidden={!isAgentPanelOpen} />
          </div>
          {/* Docked under the canvas, inside .canvas-area, so the inspector to the right of it stays
              full viewport height and the terminal spans only the canvas's own width. */}
          {terminalMounted && <TerminalPanel hidden={!isTerminalPanelOpen} />}
        </div>
        {inspectorMounted && <InspectorPanel hidden={!isInspectorOpen} />}
        <EpicBriefPanel />
      </div>
      <AgentWindowLayer />
      <DescriptionPopup />
      {codePopupNode && (
        // Keyed per node so opening a different node's popup always starts re-centered, rather
        // than inheriting a leftover drag offset from whatever was dragged around previously.
        <CodePopup
          key={codePopupNode.node_id}
          node={codePopupNode}
          onClose={() => setCodePopupNode(null)}
        />
      )}
    </div>
  );
}
