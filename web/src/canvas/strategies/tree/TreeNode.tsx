import type { HierarchyNodeRef } from "../../../state/types";
import { useNodeChildren } from "../../../state/useNodeChildren";
import { NodeButtons, NodeChangeBadge, NodeKindGlyph, NodePanels } from "../nodeChrome";
import { useNodeChrome } from "../useNodeChrome";

export interface TreeNodeProps {
  node: HierarchyNodeRef;
}

/**
 * Recursive canvas tree row (indented list, not nested boxes): a row expands in place and lazily
 * fetches its children via `EngineClient` on first expand, same as strategies/boxes/Block.tsx —
 * expand state lives in the shared ExpansionStore, keyed per node_id, never on local state.
 *
 * The behavior both strategies share lives in `../nodeChrome`; this file is just the indented-row
 * markup and its disclosure glyph.
 *
 * Also mounted outside its own strategy: the C1 view renders every level inside a system/actor box
 * as one of these rows (via Block's `ChildRenderer`), so it must match Block on description and
 * unresolved handling — an authored C1 block's meaning lives in exactly those two fields.
 */
export function TreeNode({ node }: TreeNodeProps) {
  const chrome = useNodeChrome(node);
  // Gated on has_children like Block, so expanding a description-only row neither fetches nor
  // renders an empty indented container below it.
  const children = useNodeChildren(node.node_id, chrome.isExpanded && node.has_children);
  const isFunction = node.level === "function";
  // Same rule as strategies/boxes/Block.tsx: a description-only row (an unresolved C1 block, a
  // change-review ghost) has nothing to fetch but still has something to reveal.
  const canExpand = Boolean(node.has_children || node.description);

  return (
    <div
      className={`tree-node${chrome.isCodeVisible ? " tree-node-code-open" : ""}${chrome.isDocOnlyFolder ? " tree-node-doc-only" : ""}${chrome.stateClasses}`}
      data-testid="tree-node"
      data-node-id={node.node_id}
      data-level={node.level}
      data-expand-state={chrome.expandState}
      data-code-visible={chrome.isCodeVisible}
      // Swallow without toggling: the row itself only expands from its label, but a click anywhere
      // in it must not reach an ancestor. Nested inside a C1 box, that ancestor is a Block whose
      // root toggles, so a drag-end click on an inline panel would collapse the whole box. A
      // shift/ctrl/cmd+click here (row padding, not the toggle/label) still selects the row.
      onClick={(event) => chrome.selectableClick(event, () => {})}
    >
      <div className="tree-node-main-row" data-testid="tree-node-main-row">
        <div className="tree-node-row" data-testid="tree-node-row">
          {/* Sits right beside the name, like a normal disclosure triangle, but is its own sibling
              rather than nested in the label — it toggles the row's own in-place expand. Rendered
              only when a click here would actually do that: a function (always, per its own "run"
              glyph), or a row with real authored children below it. */}
          {(isFunction || node.has_children) && (
            <span
              className="tree-node-toggle"
              data-testid="tree-node-toggle"
              onClick={(event) =>
                chrome.selectableClick(event, () => {
                  if (chrome.isCodeVisible) return;
                  if (canExpand) chrome.toggleExpand();
                })
              }
            >
              {isFunction ? "❯" : chrome.isExpanded ? "▾" : "▸"}
            </span>
          )}
          <div className="tree-node-title">
            <span
              className="tree-node-label"
              data-testid="tree-node-label"
              // The row's name/icon/badge. A node with its own change review opens the InspectorPanel
              // on it instead of expanding in place; every other row falls back to a plain toggle.
              onClick={(event) =>
                chrome.selectableClick(event, () => {
                  if (chrome.isCodeVisible) return;
                  if (chrome.openInInspector) chrome.openInInspector();
                  else if (canExpand) chrome.toggleExpand();
                })
              }
            >
              <NodeKindGlyph node={node} />
              <span className={`tree-node-name tree-node-name-${node.level}`}>{node.name}</span>
              {node.params && <span className="tree-node-params">{node.params}</span>}
              <NodeChangeBadge change={chrome.change} />
            </span>
            {chrome.isExpanded && node.description && (
              <span className="tree-node-description" data-testid="tree-node-description">
                {node.description}
              </span>
            )}
          </div>
          <div className="tree-node-actions">
            <NodeButtons node={node} chrome={chrome} variant="tree-node" />
          </div>
        </div>
        <NodePanels node={node} chrome={chrome} />
      </div>
      {!chrome.isCodeVisible && chrome.isExpanded && children && (
        <div className="tree-node-children" data-testid="tree-node-children">
          {children.map((child) => (
            <TreeNode key={child.node_id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}
