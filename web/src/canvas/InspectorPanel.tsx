import { useEffect, useRef, useState, type ReactNode } from "react";
import { EngineClientProvider, useEngineClient } from "../engine-client/EngineClientContext";
import { NodeKindIcon } from "../icons/NodeKindIcon";
import { useImpactChange } from "../state/useSidecar";
import { useDiff } from "../state/diffOverlayStore";
import { useLiveVersion } from "../state/liveStore";
import { useNodeChildren } from "../state/useNodeChildren";
import { useAcceptDiff } from "../state/useAcceptDiff";
import { CodeView } from "./CodeView";
import { DiffView } from "./DiffView";
import { PanelCloseButton } from "./PanelCloseButton";
import { InspectorChangeReview } from "./InspectorChangeReview";
import { inspectorStore, useInspectorClient, useInspectorStack, type InspectorEntry } from "./inspectorStore";
import { codeButtonWord, codeNoun } from "./strategies/codeLabels";
import { useResizableSize } from "./useResizableSize";
import type { HierarchyNodeRef } from "../state/types";

/** Widest a drag may take the panel — the user asked for ~30% by default (the CSS width) and up to
 * half the screen. */
const MAX_VIEWPORT_FRACTION = 0.5;

const MIN_WIDTH = 320;

/**
 * The C1 view's code inspector: a full-height right dock that everything below the code boundary
 * opens into, instead of being expanded inside a diagram box.
 *
 * Why it exists at all: a box that grew a folder tree inside it re-ranked dagre around its new
 * measured size, which moved every other box and dragged the relationship arrows with it. Boxes now
 * only ever contain agent-authored architecture blocks, so the diagram holds still while the user
 * reads code.
 *
 * Navigation is file-manager style rather than expand-in-place (the canvas's own idiom): one level
 * shown at a time, a `‹` button back up the drill stack. Rows carry `data-inspector-node-id` rather
 * than `data-node-id` deliberately — the canvas overlays resolve arrow endpoints with a document-wide
 * `[data-node-id]` query, and a match in here would be measured through the wrong coordinate space.
 */
export function InspectorPanel({ hidden = false }: { hidden?: boolean }) {
  const client = useInspectorClient();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { size, isResizing, handleProps } = useResizableSize(panelRef, {
    axis: "x",
    edge: "left",
    minWidth: MIN_WIDTH,
    maxViewportFraction: MAX_VIEWPORT_FRACTION,
  });

  return (
    <aside
      className={`inspector-panel${hidden ? " inspector-panel-hidden" : ""}${
        isResizing ? " inspector-panel-resizing" : ""
      }`}
      data-testid="inspector-panel"
      aria-label="Code inspector"
      ref={panelRef}
      style={size ? { width: size.width } : undefined}
    >
      <div
        className="inspector-panel-resize-handle"
        data-testid="inspector-panel-resize-handle"
        aria-hidden="true"
        {...handleProps}
      />
      {/* Fetches through the C1 client so a "+N more" remainder — whose children only that client can
          filter — resolves the same way a plain repo node does. */}
      {client ? (
        <EngineClientProvider repoId="c1" client={client}>
          <InspectorBody />
        </EngineClientProvider>
      ) : (
        <InspectorBody />
      )}
    </aside>
  );
}

function InspectorBody() {
  const stack = useInspectorStack();
  const current = stack[stack.length - 1];

  return (
    <>
      <header className="inspector-panel-header">
        {stack.length > 1 && (
          <button
            type="button"
            className="inspector-panel-back"
            aria-label="Back to the previous level"
            onClick={inspectorStore.back}
          >
            ‹
          </button>
        )}
        <span className="inspector-panel-title" data-testid="inspector-panel-title">
          {current?.name ?? "Inspector"}
        </span>
        <PanelCloseButton
          className="inspector-panel-close"
          ariaLabel="Close the code inspector"
          onClick={inspectorStore.close}
        />
      </header>
      <div className="inspector-panel-body" data-testid="inspector-panel-body">
        {current ? <InspectorLevelFor current={current} /> : null}
      </div>
    </>
  );
}

/** Renders one drill level — a single node directly, or a multi-node group as tabs. A group (from a
 * Patterns merged box's openMany) shows one tab per real node and swaps which node's code is shown. */
function InspectorLevelFor({ current }: { current: InspectorEntry }) {
  if (current.group) {
    return <InspectorGroupTabs group={current.group} />;
  }
  return <InspectorLevel entryId={current.id} />;
}

/** A tab per node in a group; the active tab's code renders beneath. Tab state is local and resets
 * when the group changes (keyed by the entry id, which is stable per group). */
function InspectorGroupTabs({ group }: { group: { ids: string[] } }) {
  const [active, setActive] = useState(0);
  const clamped = Math.min(active, group.ids.length - 1);
  const nodeId = group.ids[clamped];

  return (
    <>
      <div className="inspector-tabs" data-testid="inspector-tabs" role="tablist">
        {group.ids.map((id, index) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={index === clamped}
            className={`inspector-tab${index === clamped ? " inspector-tab--active" : ""}`}
            onClick={() => setActive(index)}
          >
            <InspectorTabLabel id={id} />
          </button>
        ))}
      </div>
      {nodeId ? <InspectorLevel entryId={nodeId} /> : null}
    </>
  );
}

/** Lazy label for one tab — the node's real name once fetched, the id as a placeholder before. */
function InspectorTabLabel({ id }: { id: string }) {
  const engineClient = useEngineClient();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    engineClient
      .getNode(id)
      .then((result) => {
        if (!cancelled && result) setName(result.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, engineClient]);
  return <span className="inspector-tab-label">{name ?? id}</span>;
}

/** Resolves one drill level's node, its Impact change review if it has one, and either its source or
 * its children. */
function InspectorLevel({ entryId }: { entryId: string }) {
  const { node, error, retry } = useInspectorNode(entryId);
  const change = useImpactChange(entryId);
  const diff = useDiff(entryId);
  const engineClient = useEngineClient();
  // No onAccepted callback: unlike an inline code view there is nothing to close — accepting clears
  // the node's entry from diffOverlayStore, so this level re-renders as plain source on its own.
  const { handleAccept, isAccepting, acceptError } = useAcceptDiff(engineClient);
  // Enabled unconditionally: unlike a canvas block there is no collapsed state here — the level the
  // user navigated to is the level being shown.
  const children = useNodeChildren(entryId, Boolean(node?.has_children));
  const [showSource, setShowSource] = useState(false);

  if (error) {
    return (
      <div className="inspector-panel-note" data-testid="inspector-panel-error">
        <p className="inspector-panel-error-text">Failed to load: {error}</p>
        <button type="button" className="inspector-code-button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }

  if (!node) {
    return <InspectorNote testId="inspector-panel-loading">Loading…</InspectorNote>;
  }

  // A real file carries both its whole text and its classes/functions, so neither may shadow the
  // other: a node with both starts on its child list behind a Show File / Show Class toggle, exactly
  // as a canvas row has a disclosure triangle and a code button side by side. A leaf (a function)
  // has nothing to list, so it opens straight on its source.
  const hasCode = Boolean(node.source);
  const hasChildren = Boolean(node.has_children);
  const sourceShown = hasCode && (showSource || !hasChildren);
  const word = codeButtonWord(node.level);

  return (
    <>
      {change && <InspectorChangeReview change={change} />}
      {hasCode && hasChildren && (
        <div className="inspector-level-actions">
          <button
            type="button"
            className="inspector-code-button"
            aria-label={`${showSource ? "Hide" : "Show"} ${codeNoun(node.level)} for ${node.name}`}
            onClick={() => setShowSource((shown) => !shown)}
          >
            {showSource ? `Hide ${word}` : `Show ${word}`}
          </button>
        </div>
      )}
      {sourceShown ? (
        diff ? (
          <DiffView
            node={node}
            diff={diff}
            className="block-code-view--inspector"
            onAccept={handleAccept}
            isAccepting={isAccepting}
            acceptError={acceptError}
          />
        ) : (
          <CodeView node={node} className="block-code-view--inspector" />
        )
      ) : (
        <InspectorChildren node={node} children={children} />
      )}
    </>
  );
}

/** The child list for one level, or the honest reason there isn't one. */
function InspectorChildren({
  node,
  children,
}: {
  node: HierarchyNodeRef;
  children: HierarchyNodeRef[] | null;
}) {
  if (!node.has_children) {
    return (
      <InspectorNote>{node.description || "Nothing to show inside this block."}</InspectorNote>
    );
  }
  if (!children) {
    return <InspectorNote testId="inspector-panel-loading">Loading…</InspectorNote>;
  }
  return (
    <ul className="inspector-list" data-testid="inspector-list">
      {children.map((child) => (
        <InspectorRow key={child.node_id} node={child} />
      ))}
    </ul>
  );
}

function InspectorNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="inspector-panel-note" data-testid={testId}>
      {children}
    </p>
  );
}

/** One child row: drilling in is the only interaction — code, if the child has any, is the next
 * level rather than an inline panel. */
function InspectorRow({ node }: { node: HierarchyNodeRef }) {
  const drillable = Boolean(node.has_children || node.source);

  return (
    <li className="inspector-list-item">
      <button
        type="button"
        className={`inspector-row${drillable ? "" : " inspector-row--leaf"}`}
        data-testid="inspector-row"
        data-inspector-node-id={node.node_id}
        data-level={node.level}
        disabled={!drillable}
        onClick={() => inspectorStore.push(node.node_id, node.name)}
      >
        <NodeKindIcon level={node.level} />
        <span className={`inspector-row-name inspector-row-name-${node.level}`}>{node.name}</span>
        {node.params && <span className="inspector-row-params">{node.params}</span>}
        {drillable && <span className="inspector-row-chevron">›</span>}
      </button>
    </li>
  );
}

/** The current level's node ref, re-fetched whenever the bridge reports a live change so an edit on
 * disk refreshes the source in place — same reconciliation rule as RootCanvas's code-popup sync.
 * A rejected fetch (bridge briefly unreachable, non-2xx) surfaces as `error` with a `retry` action,
 * and so does a resolved-but-missing id (getNode's null) — both are terminal outcomes distinct
 * from "still loading", which is the only state where `node` stays null with `error` unset. */
function useInspectorNode(nodeId: string): {
  node: HierarchyNodeRef | null;
  error: string | undefined;
  retry: () => void;
} {
  const engineClient = useEngineClient();
  const liveVersion = useLiveVersion();
  const [node, setNode] = useState<HierarchyNodeRef | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setNode(null);
    setError(undefined);
    engineClient
      .getNode(nodeId)
      .then((result) => {
        if (cancelled) return;
        if (result === null) {
          // A real, resolved answer of "no such node" -- not a pending fetch. Left as `node: null`
          // this reads identically to "hasn't arrived yet" and the level hangs on Loading… forever.
          setError(`This node (${nodeId}) no longer exists — the diagram may be out of date.`);
          return;
        }
        setNode(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, liveVersion, engineClient, retryToken]);

  return { node, error, retry: () => setRetryToken((token) => token + 1) };
}
