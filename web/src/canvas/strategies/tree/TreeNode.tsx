import type { HierarchyNodeRef } from "../../../state/types";
import { useNodeChildren } from "../../../state/useNodeChildren";
import { NodeButtons, NodeChangeBadge, NodeKindGlyph, NodePanels } from "../nodeChrome";
import { useNodeChrome } from "../useNodeChrome";

export interface TreeNodeProps {
  node: HierarchyNodeRef;
  /** Optional extra activation handler fired on a row/label click after the row's own default
   * (expand or open-in-inspector) — but only when that gesture grows the view (an expand or a leaf
   * click), never on a collapse. Lets a surface like the ProjectTree sidebar center the clicked
   * block on the canvas in addition to toggling it. */
  onActivate?: (node: HierarchyNodeRef) => void;
  /** Panel-only behavior: when set, clicking a row that has code (a file/function) opens that code
   * instead of the default expand. `onOpenCode` is called with the node when the click lands on a
   * code-capable row (so a sibling surface like the code sidebar can display it); if it's absent,
   * the row falls back to `chrome.toggleCode` (the global inline-vs-popup view). A container row
   * without code still expands as usual. */
  openCodeOnActivate?: boolean;
  onOpenCode?: (node: HierarchyNodeRef) => void;
  /** Panel-only highlight state, derived by the panel root (which subscribes to the open-files
   * store once) and threaded down so the shared row never subscribes to the sidebar's store itself
   * (and so lookups stay O(1) per row instead of an O(n) scan). `openFileIds` marks any row whose
   * file is open in the code sidebar; `activeFileId` additionally marks the currently-shown one. */
  openFileIds?: ReadonlySet<string>;
  activeFileId?: string | null;
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
export function TreeNode({
  node,
  onActivate,
  openCodeOnActivate,
  onOpenCode,
  openFileIds,
  activeFileId,
}: TreeNodeProps) {
  const chrome = useNodeChrome(node);
  // Gated on has_children like Block, so expanding a description-only row neither fetches nor
  // renders an empty indented container below it.
  const children = useNodeChildren(node.node_id, chrome.isExpanded && node.has_children);
  const isFunction = node.level === "function";
  // Same rule as strategies/boxes/Block.tsx: a description-only row (an unresolved C1 block, a
  // change-review ghost) has nothing to fetch but still has something to reveal.
  const canExpand = Boolean(node.has_children || node.description);
  // Panel-only highlight: derived from the panel root's single subscription, threaded down, so the
  // shared row never subscribes to the sidebar store itself. Only in sidebar mode
  // (openCodeOnActivate), so the canvas/C1 trees stay untouched.
  const isOpenFile = Boolean(openCodeOnActivate && openFileIds?.has(node.node_id));
  const isActive = Boolean(openCodeOnActivate && activeFileId === node.node_id);
  // The label's single behavior, shared by click and keyboard activation: open a change review,
  // else expand/collapse the row. Navigation (the sidebar's "jump to this node") happens only when
  // this gesture grows the view — an expand or a leaf. A collapse is a "put it away" gesture, so it
  // shouldn't also re-frame the camera on the node. chrome.isExpanded here is the pre-gesture value
  // (the toggle hasn't committed a re-render yet), i.e. whether the node was already open, so "was
  // collapsed" == an expand is happening.
  const activateLabel = () => {
    if (chrome.isCodeVisible) return;
    // Panel-only: a row that is a code surface (a file/class/function — NOT a folder) opens it on
    // click instead of expanding; the Show/Hide-code button is hidden there, so this is the only
    // way to reach the source. Any such row opens even when its source is empty (e.g. an __init__.py
    // with no content), so it renders as a blank file rather than not opening at all. `onOpenCode`
    // (a dedicated sidebar surface) wins over the shared inline/popup toggle when both are provided.
    if (openCodeOnActivate && node.level !== "folder") {
      if (onOpenCode) {
        onOpenCode(node);
      } else {
        chrome.toggleCode({ stopPropagation: () => {} });
      }
      if (!canExpand) onActivate?.(node);
      return;
    }
    if (chrome.openInInspector) chrome.openInInspector();
    else if (canExpand) chrome.toggleExpand();
    if (!canExpand || !chrome.isExpanded) onActivate?.(node);
  };

  return (
    <div
      className={`tree-node${isOpenFile ? " tree-node-open-file" : ""}${isActive ? " tree-node-active" : ""}${chrome.isCodeVisible ? " tree-node-code-open" : ""}${chrome.isDocOnlyFolder ? " tree-node-doc-only" : ""}${chrome.stateClasses}`}
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
              // The row's name is already the primary disclosure (keyboard-accessible via the label
              // above); making the glyph a second interactive stop is redundant, so it stays a
              // mouse/hit-area affordance and is NOT focusable.
              aria-hidden="true"
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
              // Keyboard-accessible (tabIndex + Enter/Space, the same fallback onClick runs) and
              // announced as a disclosure via aria-expanded on rows that actually expand.
              tabIndex={0}
              role={canExpand ? "button" : undefined}
              aria-expanded={canExpand ? chrome.isExpanded : undefined}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                // Reuse the selection/selectable path with a synthetic event exposing only the
                // modifier flags it reads (shift/ctrl/cmd multi-select); selection is mouse-driven,
                // so a plain keyboard activation never toggles it — fallback always runs.
                event.stopPropagation();
                activateLabel();
              }}
              onClick={(event) => chrome.selectableClick(event, activateLabel)}
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
            <NodeButtons
              node={node}
              chrome={chrome}
              variant="tree-node"
              hideCodeButton={openCodeOnActivate}
              hideFocusButton={openCodeOnActivate}
            />
          </div>
        </div>
        <NodePanels node={node} chrome={chrome} />
      </div>
      {!chrome.isCodeVisible && chrome.isExpanded && children && (
        <div className="tree-node-children" data-testid="tree-node-children">
          {children.map((child) => (
            <TreeNode
              key={child.node_id}
              node={child}
              onActivate={onActivate}
              openCodeOnActivate={openCodeOnActivate}
              onOpenCode={onOpenCode}
              openFileIds={openFileIds}
              activeFileId={activeFileId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
