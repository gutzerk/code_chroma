import type { MouseEvent as ReactMouseEvent } from "react";
import type { ImpactBlockChange, HierarchyNodeRef } from "../../state/types";
import { expansionStore, useBlockView } from "../../state/expansionState";
import { useHierarchyChangeStatus } from "../../state/hierarchyChangesStore";
import { hasOwnChangeContent, useImpactChange } from "../../state/useSidecar";
import { useIsHoveredEdgeEndpoint } from "../../state/hoveredEdgeStore";
import { selectionStore, useIsSelected } from "../../state/selectionStore";
import { useCanvasFocus } from "../CanvasFocusContext";
import { inspectorStore, useIsInspectorTarget } from "../inspectorStore";
import { useCodePopup } from "../CodePopupContext";
import { useCodeViewMode } from "../codeViewModeStore";
import { codeButtonWord, codeNoun } from "./codeLabels";

/** Everything both render strategies need per node; only the surrounding markup differs. */
export interface NodeChrome {
  /** Raw store value, surfaced as the `data-expand-state` attribute both strategies render. */
  expandState: string;
  isExpanded: boolean;
  isCodeVisible: boolean;
  hasCode: boolean;
  isDocOnlyFolder: boolean;
  /** "Show File" / "Show Class" / "Show Code", matching the node's level. */
  codeButtonWord: string;
  /** The noun in the button's aria-label — "full file", "class", or "code". */
  codeNoun: string;
  toggleCode: (event: { stopPropagation: () => void }) => void;
  focusSelf: (event: { stopPropagation: () => void }) => void;
  /** Pure expand/collapse — never redirects to the inspector. */
  toggleExpand: () => void;
  /** What the Impact change review says about this node, or undefined outside that mode / when the
   * diff doesn't touch it. Lives here rather than in each strategy so both get the badge and accent. */
  change?: ImpactBlockChange;
  /** Status class for the node's root element (" block-change--modified"), or "" when unchanged.
   * Sourced from the Impact review when there is one, else from the plain hierarchy view's own
   * per-node status (`hierarchyChangesStore`) — the two never both apply to the same rendered node. */
  changeClass: string;
  /** The whole unresolved/change/endpoint/selection/inspector-target class tail, ready to append to
   * either strategy's own level/expand classes. These state classes are deliberately shared
   * vocabulary: styles.css scopes `.tree-node.block-unresolved` and `.block-change--*` for both
   * strategies alike. */
  stateClasses: string;
  /** True while this node is part of the active multi-selection. */
  isSelected: boolean;
  /** Wraps a root/row click: shift/ctrl/cmd+click toggles this node in the multi-selection instead of
   * running `fallback`; a plain click clears any active selection first, then runs `fallback` as
   * normal (expand-toggle, open-in-inspector, …). Always stops propagation, matching every existing
   * click handler both strategies wrap this around. */
  selectableClick: (event: ReactMouseEvent, fallback: () => void) => void;
  /** Opens this node's own change review in the InspectorPanel, or null when it has none of its own
   * to show (see `hasOwnChangeContent`) — a node whose only change is a rolled-up descendant count
   * has nothing of its own to open. */
  openInInspector: (() => void) | null;
}

/**
 * The shared behavior behind both `strategies/boxes/Block` and `strategies/tree/TreeNode`: expand
 * state, the code popup-vs-inline decision, and the derived per-level button labels. Both
 * strategies used to hold an identical copy of this block of hooks; they now differ only in the
 * markup they wrap around it.
 *
 * `selectable` gates the Miro-style multi-select/group-drag wiring (shift/ctrl-click toggle, the
 * `block-selected` class): only a real group-drag participant should ever set it. Today that's
 * `TopLevelChildren.tsx`'s direct children of the tree's true root — the only nodes anywhere in
 * either strategy that `useSelectionAwareDrag` actually moves as a group. Every other node (the
 * default) stays out of `selectionStore` entirely: nested/flow-laid-out blocks and every tree-
 * strategy row have no drag participant to join, so letting them toggle into the same global
 * selection just left them highlighted and polluting a diagram-boxes group-drag with ids that were
 * never really part of it.
 */
export function useNodeChrome(node: HierarchyNodeRef, selectable = false): NodeChrome {
  const view = useBlockView(node.node_id);
  const focusOnNode = useCanvasFocus();
  const openCodePopup = useCodePopup();
  const codeViewMode = useCodeViewMode();
  const change = useImpactChange(node.node_id);
  const hierarchyChangeStatus = useHierarchyChangeStatus(node.node_id);
  const isEdgeEndpoint = useIsHoveredEdgeEndpoint(node.node_id);
  // Always called (hooks can't be conditional) but forced false for a non-participant node below, so
  // a stray id left in selectionStore by something else can never paint this row as selected.
  const rawIsSelected = useIsSelected(node.node_id);
  const isSelected = selectable && rawIsSelected;
  const isInspectorTarget = useIsInspectorTarget(node.node_id);
  // A pure rollup ancestor (badged only because a descendant changed, nothing of its own to show)
  // must behave exactly like it does outside diff mode — so `hasReview` rather than the mere presence
  // of `change` is what actually gates opening the review below.
  const hasReview = Boolean(change) && hasOwnChangeContent(change!);

  const changeClass = change
    ? ` block-change--${change.status}`
    : hierarchyChangeStatus
      ? ` block-change--${hierarchyChangeStatus}`
      : "";
  const stateClasses = `${node.unresolved ? " block-unresolved" : ""}${changeClass}${
    isEdgeEndpoint ? " node-edge-endpoint" : ""
  }${isSelected ? " block-selected" : ""}${isInspectorTarget ? " block-inspector-target" : ""}`;

  return {
    change,
    changeClass,
    stateClasses,
    isSelected,
    selectableClick: (event, fallback) => {
      event.stopPropagation();
      if (selectable && (event.shiftKey || event.metaKey || event.ctrlKey)) {
        selectionStore.toggle(node.node_id);
        return;
      }
      selectionStore.clear();
      fallback();
    },
    openInInspector: hasReview ? () => inspectorStore.open(node.node_id, node.name) : null,
    expandState: view.expand_state,
    isExpanded: view.expand_state === "expanded",
    isCodeVisible: view.code_visible,
    hasCode: Boolean(node.source),
    isDocOnlyFolder: node.level === "folder" && Boolean(node.doc_only),
    codeButtonWord: codeButtonWord(node.level),
    codeNoun: codeNoun(node.level),
    toggleCode: (event) => {
      event.stopPropagation();
      if (codeViewMode === "popup") {
        openCodePopup(node);
        return;
      }
      expansionStore.toggleCode(node.node_id);
    },
    focusSelf: (event) => {
      event.stopPropagation();
      focusOnNode(node.node_id);
    },
    // Pure expand/collapse — a click can land on either the row's arrow (always this) or the rest of
    // the row (`openInInspector` first when this node has its own review, see TreeNode's click).
    toggleExpand: () => {
      expansionStore.toggleExpand(node.node_id);
    },
  };
}
