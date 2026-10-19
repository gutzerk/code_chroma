import { useEffect, useState } from "react";
import { CodeView } from "../canvas/CodeView";
import { openFilesStore, useActiveFileId, useOpenFiles } from "../canvas/openFilesStore";
import { shellStore, useShellState } from "./shellStore";
import { useDisclosureMenu } from "../util/useDisclosureMenu";
import type { HierarchyNodeRef } from "../state/types";
import "./codeOverlay.css";

/** How many tabs fit before the overflow "▾" appears. */
const MAX_TABS = 8;

/** A box click: opens the node's source in the overlay (re-click on the active file closes its tab). */
export function openCodeFor(node: HierarchyNodeRef): void {
  openFilesStore.toggle(node);
  if (openFilesStore.getFiles().length > 0) shellStore.openCodeOverlay();
  else shellStore.closeCodeOverlay();
}

/** Code panel laid over its (positioned) parent, normally the agents panel; null while closed. */
export function CodeOverlay() {
  const { codeOverlayOpen } = useShellState();
  const files = useOpenFiles();
  const activeId = useActiveFileId();
  const [menuOpen, setMenuOpen] = useState(false);
  const { containerRef, triggerRef, onListKeyDown } = useDisclosureMenu(menuOpen, () =>
    setMenuOpen(false),
  );

  useEffect(() => {
    if (!codeOverlayOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") shellStore.closeCodeOverlay();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [codeOverlayOpen]);

  if (!codeOverlayOpen) return null;
  const active = files.find((f) => f.node_id === activeId) ?? null;
  const overflow = files.slice(MAX_TABS);

  return (
    <div className="code-overlay" role="dialog" aria-label="Code" data-testid="code-overlay">
      <div className="code-overlay-bar">
        <div className="code-overlay-tabs" role="tablist" data-testid="code-overlay-tabs">
          {files.slice(0, MAX_TABS).map((file) => (
            <div
              key={file.node_id}
              className={`code-overlay-tab${file.node_id === activeId ? " is-active" : ""}`}
              role="tab"
              aria-selected={file.node_id === activeId}
              tabIndex={0}
              data-testid="code-overlay-tab"
              onClick={() => openFilesStore.activate(file.node_id)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                openFilesStore.activate(file.node_id);
              }}
            >
              <span className="code-overlay-tab-name">{file.name}</span>
              <span
                className="code-overlay-tab-close"
                role="button"
                tabIndex={0}
                aria-label={`Close ${file.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openFilesStore.close(file.node_id);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  e.stopPropagation();
                  openFilesStore.close(file.node_id);
                }}
              >
                ✕
              </span>
            </div>
          ))}
          {overflow.length > 0 && (
            <div className="code-overlay-overflow" ref={containerRef}>
              <button
                type="button"
                aria-label="Show all open files"
                aria-expanded={menuOpen}
                ref={triggerRef}
                onClick={() => setMenuOpen((o) => !o)}
              >
                ▾
              </button>
              {menuOpen && (
                <ul className="code-overlay-menu" role="menu" onKeyDown={onListKeyDown}>
                  {files.map((file) => (
                    <li key={file.node_id}>
                      <div
                        role="menuitem"
                        tabIndex={0}
                        aria-label={`Open ${file.name}`}
                        className={file.node_id === activeId ? "is-active" : ""}
                        onClick={() => {
                          openFilesStore.activate(file.node_id);
                          setMenuOpen(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          openFilesStore.activate(file.node_id);
                          setMenuOpen(false);
                        }}
                      >
                        {file.name}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="code-overlay-close"
          aria-label="Close code"
          onClick={shellStore.closeCodeOverlay}
        >
          ✕
        </button>
      </div>
      <div className="code-overlay-body" data-testid="code-overlay-body">
        {active ? (
          <CodeView node={active} className="code-overlay-view" />
        ) : (
          <p className="code-overlay-empty">No file open</p>
        )}
      </div>
    </div>
  );
}
