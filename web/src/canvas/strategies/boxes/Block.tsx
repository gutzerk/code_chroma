import type { ComponentType, CSSProperties } from "react";
import type { HierarchyNodeRef } from "../../../state/types";
import { useNodeChildren } from "../../../state/useNodeChildren";
import { NodeButtons, NodeChangeBadge, NodeKindGlyph, NodePanels } from "../nodeChrome";
import type { CanvasNodeRendererProps } from "../types";
import { useNodeChrome } from "../useNodeChrome";
import { BLOCK_LAYOUT } from "./layoutConfig";
import { TopLevelChildren } from "./TopLevelChildren";

export interface BlockProps {
  node: HierarchyNodeRef;
  /** Extra classes on the root element — e.g. the C1 view's actor color accents. */
  className?: string;
  /** Renderer for this block's children — the C1 view passes TreeNode so a box's interior is an
   * indented tree. Deliberately not propagated: the child renderer owns its own recursion. */
  ChildRenderer?: ComponentType<CanvasNodeRendererProps>;
  /** True only for the one Block instance a real group-drag participant wraps (today,
   * `TopLevelChildren.tsx`'s direct children of the tree's true root) — see useNodeChrome's own
   * doc comment. Defaults false and is deliberately never passed down to `Child` below, so a
   * flow-laid-out descendant several levels deep can never join the multi-selection either. */
  selectable?: boolean;
}

/**
 * Recursive nested-block component (research.md Decision 1): a block expands in place and lazily
 * fetches its children via `EngineClient` on first expand (FR-002-FR-004). Any number of siblings
 * and arbitrary simultaneous depths can be expanded at once — expansion state lives in the global
 * ExpansionStore, keyed per node_id, never on this component's own local state.
 *
 * Everything this shares with the tree strategy (expand state, code popup-vs-inline, diff/accept,
 * plan steps) lives in `../nodeChrome`; what's left here is the nested-box markup itself.
 */
export function Block({ node, className, ChildRenderer, selectable = false }: BlockProps) {
  const chrome = useNodeChrome(node, selectable);
  const children = useNodeChildren(node.node_id, chrome.isExpanded && node.has_children);
  // The true root's own children (the top-level Systems) get Miro-style drag-to-reposition instead
  // of the ordinary flow-grid layout every deeper level still uses — see TopLevelChildren.tsx.
  // Only the plain hierarchy strategy: a foreign ChildRenderer (C1's synthetic system/actor boxes,
  // which also carry parent_id: null) already gets its own top-rank drag via C1View's own anchors.
  const isTopLevelRoot = node.parent_id === null && !ChildRenderer;
  const Child = ChildRenderer ?? Block;
  const useColumnLayout =
    node.level === "class" || (children?.length ?? 0) > BLOCK_LAYOUT.maxRowColumns;
  // A foreign child renderer lays its own subtree out vertically, so the 5-column grid and its
  // per-column min-width floor would only stretch the box.
  const childLayoutClass = ChildRenderer
    ? "block-children-tree"
    : useColumnLayout
      ? "block-children-column"
      : "block-children-row";
  const rowColumns = children
    ? Math.min(children.length, BLOCK_LAYOUT.maxRowColumns)
    : BLOCK_LAYOUT.maxRowColumns;

  return (
    <div
      className={`block block-${node.level} ${chrome.isExpanded ? "block-expanded" : "block-collapsed"}${chrome.isCodeVisible ? " block-code-open" : ""}${chrome.isDocOnlyFolder ? " block-doc-only" : ""}${chrome.stateClasses}${className ? ` ${className}` : ""}`}
      data-testid="block"
      data-node-id={node.node_id}
      // The marquee's own lookup key (CanvasViewport.tsx/selectionStore) -- only a `selectable` box
      // (see useNodeChrome's own doc comment) is ever a real marquee/group-drag candidate, so a
      // non-participant several levels deep never adds itself to a rubber-band selection either.
      data-select-id={selectable ? node.node_id : undefined}
      data-level={node.level}
      data-expand-state={chrome.expandState}
      data-code-visible={chrome.isCodeVisible}
      onClick={(event) =>
        chrome.selectableClick(event, () => {
          if (chrome.isCodeVisible) return;
          if (node.has_children || node.description) chrome.toggleExpand();
        })
      }
    >
      <div
        className={`block-row${ChildRenderer ? " block-row--panel-overlay" : ""}`}
        data-testid="block-row"
      >
        <div className="block-header" data-testid="block-header">
          <div className="block-title">
            <span className="block-name-row">
              <NodeKindGlyph node={node} />
              <span className={`block-name block-name-${node.level}`}>{node.name}</span>
              <NodeChangeBadge change={chrome.change} />
            </span>
            {node.params && <span className="block-params">{node.params}</span>}
            {chrome.isExpanded && node.description && (
              <span className="block-description" data-testid="block-description">
                {node.description}
              </span>
            )}
          </div>
          <NodeButtons node={node} chrome={chrome} variant="block" />
        </div>
        <NodePanels node={node} chrome={chrome} />
      </div>
      {!chrome.isCodeVisible &&
        chrome.isExpanded &&
        children &&
        (isTopLevelRoot ? (
          <TopLevelChildren nodes={children} />
        ) : (
          <div
            className={`block-children ${childLayoutClass}`}
            data-testid="block-children"
            style={
              childLayoutClass === "block-children-row"
                ? ({ "--block-child-columns": rowColumns } as CSSProperties)
                : undefined
            }
          >
            {children.map((child) => (
              <Child key={child.node_id} node={child} />
            ))}
          </div>
        ))}
    </div>
  );
}
