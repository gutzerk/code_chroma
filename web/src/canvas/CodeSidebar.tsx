import { useState } from "react";
import type { HierarchyNodeRef } from "../state/types";
import { CodeView } from "./CodeView";
import { ResizableRail } from "./ResizableRail";
import { useDisclosureMenu } from "../util/useDisclosureMenu";
import { openFilesStore, useActiveFileId, useOpenFiles } from "./openFilesStore";

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 260;

/** How many tabs fit before the overflow "▾" appears — realistically governed by the panel width,
 * but a fixed cap keeps the dropdown path reachable even at a very wide panel. */
const MAX_TABS = 8;

/**
 * The code sidebar (variant A): a resizable panel right beside the project tree showing the source
 * of every file opened there. Tabs run in most-recently-viewed order (openFilesStore's MRU list); a
 * tab's ✕ closes it. When more files are open than fit on the strip (`MAX_TABS`), the extra ones
 * collapse behind the trailing "▾" button, which opens a dropdown listing every open file — picking
 * one activates it. The active file's source renders through the shared `CodeView`.
 */
export function CodeSidebar({ hidden }: { hidden: boolean }) {
  const files = useOpenFiles();
  const activeId = useActiveFileId();
  const [menuOpen, setMenuOpen] = useState(false);
  const { containerRef, triggerRef, onListKeyDown } = useDisclosureMenu(menuOpen, () =>
    setMenuOpen(false),
  );
  const active = files.find((f) => f.node_id === activeId) ?? null;

  // No empty panel between tree and canvas when nothing is open — skip rendering entirely. (This
  // does reset a dragged width if the user closes every tab, an acceptable trade for clean UX.)
  if (files.length === 0) return null;

  const visibleTabs = files.slice(0, MAX_TABS);
  const overflow = files.slice(MAX_TABS);

  return (
    <ResizableRail
      className="code-sidebar"
      resizingClass="code-sidebar--resizing"
      ariaLabel="Open files"
      dataTestid="code-sidebar"
      handleTestid="code-sidebar-resize-handle"
      defaultWidth={DEFAULT_WIDTH}
      minWidth={MIN_WIDTH}
      hidden={hidden}
    >
      <div className="code-sidebar-tabs" role="tablist" data-testid="code-sidebar-tabs">
        {visibleTabs.map((file) => (
          <Tab key={file.node_id} file={file} active={file.node_id === activeId} />
        ))}
        {overflow.length > 0 && (
          <div className="code-sidebar-tabs-overflow" ref={containerRef}>
            <button
              type="button"
              className="code-sidebar-overflow-button"
              aria-label="Show all open files"
              aria-expanded={menuOpen}
              ref={triggerRef}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ▾
            </button>
            {menuOpen && (
              <ul
                className="code-sidebar-overflow-menu"
                role="menu"
                onKeyDown={onListKeyDown}
              >
                {files.map((file) => (
                  <li key={file.node_id}>
                    {/* A div (not button): the item has TWO interactive descendants (pick + close),
                        and nesting one interactive element inside another is an a11y failure. The
                        name picks on click/Enter; the ✕ (CloseGlyph) closes — each its own focus
                        target, side by side. */}
                    <div
                      role="menuitem"
                      aria-label={`Open ${file.name}`}
                      tabIndex={0}
                      className={`code-sidebar-overflow-item${file.node_id === activeId ? " is-active" : ""}`}
                      onClick={() => {
                        openFilesStore.activate(file.node_id);
                        setMenuOpen(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        openFilesStore.activate(file.node_id);
                        setMenuOpen(false);
                      }}
                    >
                      <span className="code-sidebar-overflow-name">{file.name}</span>
                      <CloseGlyph
                        name={file.name}
                        nodeId={file.node_id}
                        className="code-sidebar-overflow-close"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {/* active is always set here: the store keeps activeId pointing at an open file, we returned
          early when the list is empty, and this panel stays mounted (latched) hidden otherwise. */}
      <div className="code-sidebar-body" id="code-sidebar-body" data-testid="code-sidebar-body">
        <CodeView node={active!} className="code-sidebar-view" />
      </div>
    </ResizableRail>
  );
}

function Tab({ file, active }: { file: HierarchyNodeRef; active: boolean }) {
  const activate = () => openFilesStore.activate(file.node_id);
  return (
    <div
      className={`code-sidebar-tab${active ? " is-active" : ""}`}
      role="tab"
      aria-selected={active}
      aria-controls="code-sidebar-body"
      // Keyboard-operable like the tree rows: focusable + activates on Enter/Space (a plain `div`
      // with only onClick would be mouse-only).
      tabIndex={0}
      data-testid="code-sidebar-tab"
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate();
      }}
    >
      <span className="code-sidebar-tab-name">{file.name}</span>
      <CloseGlyph name={file.name} nodeId={file.node_id} />
    </div>
  );
}

/** The tab's / overflow item's ✕ — shared so tab-close semantics (label + stopPropagation + close)
 * live in one place instead of two drifting copies. `className` selects the tab vs overflow styling.
 * A `span role="button"` (not a real button) because it must nest inside the tab div and the
 * overflow `<button role="menuitem">`; focusable + Enter/Space so closing works without a mouse. */
function CloseGlyph({ name, nodeId, className }: { name: string; nodeId: string; className?: string }) {
  const close = () => openFilesStore.close(nodeId);
  return (
    <span
      className={className ?? "code-sidebar-tab-close"}
      role="button"
      aria-label={`Close ${name}`}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      ✕
    </span>
  );
}
