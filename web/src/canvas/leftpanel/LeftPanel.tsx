import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DeleteDiagramDialog } from "../../agents/DeleteDiagramDialog";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import type { HierarchyNodeRef } from "../../state/types";
import { useCanvasDoc } from "../doc/canvasDocStore";
import { deleteDiagramAndRefresh } from "../doc/diagramCatalog";
import { DrawDiagramButton } from "../doc/DrawDiagramButton";
import { ShareMenu } from "../../share/ShareMenu";
import { layoutStore, useLayoutState, type LeftTab } from "../layout/layoutStore";
import { Z_LEFT_PANEL } from "../layout/layoutMetrics";
import { openFilesStore, useActiveFileId, useOpenFiles } from "../openFilesStore";
import { TreeNode } from "../strategies/tree/TreeNode";
import { colorForLayer } from "./diagramColors";
import { diagramSelectionStore, useSelectedDiagrams } from "./diagramSelectionStore";
import { useDiagramRows } from "./useDiagramRows";
import "../PanelHandle.css";
import "./LeftPanel.css";

const TABS: { id: LeftTab; label: string }[] = [
  { id: "diagrams", label: "Diagrams" },
  { id: "files", label: "Files" },
];

/** The open left panel: Diagrams (select / hide / delete rows, Draw, Arrange slot) and Files tabs. */
export function LeftPanel({
  rootNode,
  onActivate,
  arrange,
}: {
  rootNode: HierarchyNodeRef | null;
  onActivate: (nodeId: string) => void;
  /** The Arrange section, rendered at the bottom of the Diagrams tab. */
  arrange?: ReactNode;
}) {
  const { leftTab } = useLayoutState();
  const hasOpenCode = useOpenFiles().length > 0 && leftTab === "files";
  return (
    <aside
      className="left-panel"
      aria-label="Diagrams and files"
      data-testid="left-panel"
      style={{ zIndex: Z_LEFT_PANEL }}
    >
      <div className="left-panel-tabs" role="tablist" aria-label="Left panel">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="left-panel-tab"
            aria-selected={leftTab === tab.id}
            onClick={() => layoutStore.openLeft(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {leftTab === "diagrams" ? <DiagramsTab arrange={arrange} rootName={rootNode?.name} /> : <FilesTab rootNode={rootNode} onActivate={onActivate} />}
      {!hasOpenCode && (
        <div className="panel-handle panel-handle--right-edge">
          <button
            type="button"
            className="panel-handle-btn"
            aria-label="Collapse diagrams panel"
            onClick={layoutStore.closeLeft}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
}

function FilesTab({
  rootNode,
  onActivate,
}: {
  rootNode: HierarchyNodeRef | null;
  onActivate: (nodeId: string) => void;
}) {
  const openFiles = useOpenFiles();
  const activeFileId = useActiveFileId();
  const openFileIds = useMemo(() => new Set(openFiles.map((f) => f.node_id)), [openFiles]);
  return (
    <div className="left-panel-files" data-testid="left-panel-files">
      {rootNode && (
        <TreeNode
          node={rootNode}
          onActivate={(node) => onActivate(node.node_id)}
          openCodeOnActivate
          onOpenCode={(node) => openFilesStore.toggle(node)}
          openFileIds={openFileIds}
          activeFileId={activeFileId}
        />
      )}
    </div>
  );
}

function DiagramsTab({ arrange, rootName }: { arrange?: ReactNode; rootName?: string }) {
  const engineClient = useEngineClient();
  const doc = useCanvasDoc();
  const rows = useDiagramRows();
  const layers = useMemo(() => rows.map((row) => row.layer), [rows]);
  const selected = useSelectedDiagrams();
  const [deletingLayer, setDeletingLayer] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    diagramSelectionStore.prune(layers);
  }, [layers]);

  const countByLayer = useMemo(() => {
    const counts = new Map<string, number>();
    for (const element of Object.values(doc.elements)) {
      counts.set(element.layer, (counts.get(element.layer) ?? 0) + 1);
    }
    return counts;
  }, [doc]);

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

  return (
    <div className="left-panel-body" role="tabpanel" aria-label="Diagrams">
      <div className="left-panel-header">
        <span className="left-panel-label">ON CANVAS · {layers.length}</span>
        <div className="left-panel-header-actions">
          <ShareMenu name={rootName} layers={selected} />
          <DrawDiagramButton />
        </div>
      </div>
      {layers.length === 0 ? (
        <p className="left-panel-empty">No diagrams yet — click Draw… to create one.</p>
      ) : (
        <ul className="left-panel-list">
          {rows.map(({ layer, name, typeLabel, hidden, toggleLabel, toggle }) => {
            const count = countByLayer.get(layer) ?? 0;
            const isSelected = selected.includes(layer);
            return (
              <li
                key={layer}
                className="left-panel-row"
                data-testid={`left-panel-row-${layer}`}
                data-selected={isSelected}
                data-hidden={hidden}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${name}`}
                  checked={isSelected}
                  onChange={() => diagramSelectionStore.toggle(layer)}
                />
                <span className="left-panel-swatch" style={{ background: colorForLayer(layer) }} />
                <div className="left-panel-row-text">
                  <span className="left-panel-row-name" title={name}>{name}</span>
                  <span className="left-panel-row-meta">
                    {typeLabel && (
                      <span className="left-panel-row-type" data-testid={`left-panel-row-type-${layer}`}>
                        {`${typeLabel.toUpperCase()} · `}
                      </span>
                    )}
                    {count} {count === 1 ? "element" : "elements"}
                  </span>
                </div>
                <button
                  type="button"
                  className="left-panel-icon-btn left-panel-eye"
                  aria-label={toggleLabel}
                  onClick={toggle}
                >
                  <EyeIcon hidden={hidden} />
                </button>
                <button
                  type="button"
                  className="left-panel-icon-btn"
                  aria-label={`Delete ${name}`}
                  data-testid={`diagram-delete-${layer}`}
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingLayer(layer);
                  }}
                >
                  🗑
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {arrange}
      {deletingLayer && (
        <DeleteDiagramDialog
          label={rows.find((row) => row.layer === deletingLayer)?.name ?? deletingLayer}
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

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {hidden ? (
        <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.9 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
      ) : (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
