import { useEffect, useRef, useState } from "react";
import type { ImpactBlockChange, ImpactChangeStatus, HierarchyNodeRef } from "../../state/types";
import { expansionStore } from "../../state/expansionState";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { CodeView } from "../CodeView";
import { DiffView } from "../DiffView";
import { useDiff } from "../../state/diffOverlayStore";
import { useAcceptDiff } from "../../state/useAcceptDiff";
import { ChangeCardsPanel } from "../ChangeCardsPanel";
import { useChangeCards } from "../../state/changeCardStore";
import { useIsWorkspaceReadOnly } from "../../agents/workspaceStore";
import { nodeCopyText } from "./nodeCopyText";
import type { NodeChrome } from "./useNodeChrome";
import { NodeKindIcon } from "../../icons/NodeKindIcon";
import { C1BlockIcon } from "../../icons/C1BlockIcon";
import { BrandIcon } from "../../icons/BrandIcon";
import { ALL_BRAND_ICONS } from "../../icons/brands";

const CHANGE_MARK: Record<string, string> = { added: "+", modified: "~", removed: "−" };

/** The name-row glyph, shared by both render strategies (and C1, which mounts them for its boxes
 * too). Precedence: a recognized `icon` (real brand logo) wins over `kind` (an abstract
 * architectural glyph) wins over the generic folder/file/class icon — an unrecognized or unset
 * `icon` falls straight through to `kind`, so a diagram never renders a broken logo. */
export function NodeKindGlyph({ node }: { node: HierarchyNodeRef }) {
  if (node.icon && node.icon in ALL_BRAND_ICONS) return <BrandIcon slug={node.icon} />;
  return node.kind ? <C1BlockIcon kind={node.kind} /> : <NodeKindIcon level={node.level} />;
}

/** How long the button shows its copied/failed glyph before returning to the copy icon. */
const COPY_FLASH_MS = 1200;

const COPY_GLYPH = { idle: <CopyIcon />, copied: "✓", failed: "✕" };

/** Two overlapping rounded squares -- the idle copy glyph; strokes follow the button's text color. */
function CopyIcon() {
  return (
    <svg
      className="copy-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="2.2" />
      <path d="M10.5 3.7V4a2.2 2.2 0 0 0-2.2-2.2H4A2.2 2.2 0 0 0 1.8 4v4.3A2.2 2.2 0 0 0 4 10.5h.3" />
    </svg>
  );
}

/** Fold a per-file status into the badge's status vocabulary: change-cards can carry a `deleted`
 * file inside a still-present file's box, and the badge has no `deleted` mark — it reads as removed. */
function badgeKeyOf(status: ImpactChangeStatus | "deleted"): ImpactChangeStatus {
  return status === "deleted" ? "removed" : status;
}

/** The Impact change-status chips ("~2", "+1") shown on a box the current diff touches. A box whose
 * subtree mixes statuses (e.g. `useSidecar.ts` holding both a `modified` and a `deleted` file) carries
 * one chip per distinct status, not just the single aggregated `change.status` — so a block with both
 * added and modified files shows `+1 ~2` rather than hiding one under the other. When `files` is
 * empty (a box with only a prose review, no per-file attribution) it falls back to one chip from the
 * aggregate `status`/`change_count`, preserving the old single-chip shape. Renders only in the
 * impact-changes mode; inert, the block's own click opens the panel. Takes the change directly (not
 * the whole `NodeChrome`) so `CanvasNodeBox` can reuse it for an Impact recipe box too, keyed by
 * `meta.recipe_key` rather than a hierarchy `node_id`. */
export function NodeChangeBadge({ change }: { change: ImpactBlockChange | undefined }) {
  if (!change) return null;
  // Order chips deterministically (added, then modified, then removed) regardless of `files` order.
  const order: ImpactChangeStatus[] = ["added", "modified", "removed"];
  const counts = new Map<ImpactChangeStatus, number>();
  if (change.files.length > 0) {
    for (const file of change.files) {
      const key = badgeKeyOf(file.status);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  } else {
    counts.set(badgeKeyOf(change.status), change.change_count);
  }
  const chips = order.filter((status) => counts.has(status));
  // Fall through to a single raw chip only when the status is one the badge doesn't order at all
  // (can't happen today — ImpactChangeStatus is a subset of the order — but keeps a future status
  // from silently rendering no chip). `badgeKeyOf` isn't applied here so an unknown status shows as
  // itself rather than hiding under "removed".
  if (chips.length === 0) chips.push(change.status);
  return (
    <>
      {chips.map((status) => {
        const count = counts.get(status) ?? 0;
        return (
          <span
            key={status}
            className={`node-change-badge node-change-badge--${status}`}
            data-testid="node-change-badge"
            data-status={status}
            title={change.after || change.before || `${status} vs last commit`}
          >
            {CHANGE_MARK[status] ?? "~"}
            {count > 0 ? count : ""}
          </span>
        );
      })}
    </>
  );
}

export interface NodeButtonsProps {
  node: HierarchyNodeRef;
  chrome: NodeChrome;
  /** Class prefix for the two buttons — "block" or "tree-node". */
  variant: string;
  /** Hide the Show/Hide-code button — the ProjectTree sidebar opens code by clicking the row
   * itself (TreeNode's openCodeOnActivate), so a redundant explicit button there is dropped. */
  hideCodeButton?: boolean;
  /** Hide the Center (⊙) focus button — the sidebar navigates/focuses on row click already, so the
   * per-row focus button is redundant there. */
  hideFocusButton?: boolean;
}

/** Copies `text` to the clipboard, flashing the outcome. Own component rather than part of
 * `NodeChrome` so the flash state stays local to the button — reused by both the hierarchy
 * strategies' `NodeCopyButton` (below) and `CanvasNodeBox`'s recipe-authored boxes directly, since
 * those have a `CanvasElement`, not a `HierarchyNodeRef`, to derive copy text from. */
export function CopyButton({
  text,
  name,
  variant,
  testId,
}: {
  text: string;
  name: string;
  variant: string;
  testId?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (next: "copied" | "failed") => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), COPY_FLASH_MS);
  };

  return (
    <button
      type="button"
      className={`${variant}-copy-button${state === "idle" ? "" : ` is-${state}`}`}
      aria-label={`Copy ${name}`}
      title={`Copy ${text}`}
      data-copy-state={state}
      data-testid={testId}
      onClick={(event) => {
        // The block root and the tree label both toggle expand on click.
        event.stopPropagation();
        const write = navigator.clipboard?.writeText(text);
        if (!write) {
          flash("failed");
          return;
        }
        write.then(() => flash("copied")).catch(() => flash("failed"));
      }}
    >
      {COPY_GLYPH[state]}
    </button>
  );
}

/** `CopyButton` bound to a real hierarchy node's own copy text (see `nodeCopyText`). */
function NodeCopyButton({ node, variant }: { node: HierarchyNodeRef; variant: string }) {
  return <CopyButton text={nodeCopyText(node)} name={node.name} variant={variant} />;
}

/** The Show/Hide-code, Copy and Center buttons, identical in both strategies bar their class names. */
export function NodeButtons({
  node,
  chrome,
  variant,
  hideCodeButton,
  hideFocusButton,
}: NodeButtonsProps) {
  return (
    <>
      {!hideCodeButton && chrome.hasCode && (
        <button
          type="button"
          className={`${variant}-code-button`}
          aria-label={`${chrome.isCodeVisible ? "Hide" : "Show"} ${chrome.codeNoun} for ${node.name}`}
          onClick={chrome.toggleCode}
        >
          {chrome.isCodeVisible ? `Hide ${chrome.codeButtonWord}` : `Show ${chrome.codeButtonWord}`}
        </button>
      )}
      <NodeCopyButton node={node} variant={variant} />
      {!hideFocusButton && (
        <button
          type="button"
          className={`${variant}-focus-button`}
          aria-label={`Center ${node.name}`}
          onClick={chrome.focusSelf}
        >
          ⊙
        </button>
      )}
    </>
  );
}

/** The inline code/diff window plus the change-cards panel — same in both strategies. The
 * Impact change review itself now lives in the inspector panel (see `InspectorChangeReview`), not
 * here. */
export function NodePanels({ node, chrome }: { node: HierarchyNodeRef; chrome: NodeChrome }) {
  const diff = useDiff(node.node_id);
  const engineClient = useEngineClient();
  const { handleAccept, isAccepting, acceptError } = useAcceptDiff(
    engineClient,
    expansionStore.hideCode,
  );
  const changeCards = useChangeCards(node.node_id);
  // No Accept in a pull-request workspace: it is a view of someone else's branch, not a working copy.
  const readOnly = useIsWorkspaceReadOnly();

  return (
    <>
      {chrome.isCodeVisible &&
        (diff ? (
          <DiffView
            node={node}
            diff={diff}
            className="block-code-view--inline"
            draggable
            resizable
            onAccept={readOnly ? undefined : handleAccept}
            isAccepting={isAccepting}
            acceptError={acceptError}
          />
        ) : (
          <CodeView node={node} className="block-code-view--inline" draggable resizable />
        ))}
      {/* Not gated on expansion, unlike the Impact change review: a change card is a one-liner, not prose. */}
      <ChangeCardsPanel cards={changeCards} className="block-code-view--inline" draggable resizable />
    </>
  );
}
