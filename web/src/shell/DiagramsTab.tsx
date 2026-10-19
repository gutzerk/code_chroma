import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DeleteDiagramDialog } from "../agents/DeleteDiagramDialog";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { useCanvasDoc } from "../canvas/doc/canvasDocStore";
import {
  deleteDiagramAndRefresh,
  listActiveDiagramLayers,
  useCustomDiagramTypes,
} from "../canvas/doc/diagramCatalog";
import { diagramAccent, diagramDisplayName } from "../canvas/doc/diagramDisplay";
import { DrawPopover } from "./DrawPopover";
import { diagramSelectionStore, useSelectedLayers } from "./diagramSelectionStore";
import { shellStore, useShellState } from "./shellStore";
import "./diagramsTab.css";

export interface DiagramsTabProps {
  /** Called by the "Draw…" button; when omitted the button toggles the built-in kind popover. */
  onDraw?: () => void;
  /** Rendered below the list (the Arrange controls). */
  arrangeSlot?: ReactNode;
}

/** The left panel's Diagrams tab: one row per diagram on the canvas with select, colour, name and hide. */
export function DiagramsTab({ onDraw, arrangeSlot }: DiagramsTabProps) {
  const engineClient = useEngineClient();
  const doc = useCanvasDoc();
  const customTypes = useCustomDiagramTypes(engineClient);
  const { hiddenLayers } = useShellState();
  const selected = useSelectedLayers();
  const layers = useMemo(() => listActiveDiagramLayers(doc), [doc]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [menuLayer, setMenuLayer] = useState<string | null>(null);
  const [deletingLayer, setDeletingLayer] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    diagramSelectionStore.prune(layers);
  }, [layers]);

  const confirmDelete = () => {
    if (!deletingLayer) return;
    setDeleteBusy(true);
    setDeleteError(null);
    void deleteDiagramAndRefresh(engineClient, deletingLayer)
      .then((result) => {
        if (result.ok) setDeletingLayer(null);
        else setDeleteError(result.error);
      })
      .catch((err: unknown) => setDeleteError(err instanceof Error ? err.message : "delete failed"))
      .finally(() => setDeleteBusy(false));
  };

  const onDrawClick = () => {
    if (onDraw) onDraw();
    else setPopoverOpen((open) => !open);
  };

  return (
    <div className="diagrams-tab" data-testid="diagrams-tab">
      <div className="diagrams-tab-header">
        <span className="diagrams-tab-title">{`ON CANVAS · ${layers.length}`}</span>
        <button type="button" className="diagrams-tab-draw" data-testid="diagrams-tab-draw" onClick={onDrawClick}>
          Draw…
        </button>
        {popoverOpen && !onDraw && <DrawPopover onClose={() => setPopoverOpen(false)} />}
      </div>
      {layers.length === 0 ? (
        <p className="diagrams-tab-empty">No diagrams on the canvas yet.</p>
      ) : (
        <ul className="diagrams-tab-list">
          {layers.map((layer) => {
            const { name, typeLabel, boxCount } = diagramDisplayName(layer, doc, customTypes);
            const hidden = hiddenLayers.includes(layer);
            return (
              <li
                key={layer}
                className={`diagrams-tab-row${hidden ? " diagrams-tab-row--hidden" : ""}`}
                data-testid={`diagrams-tab-row-${layer}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${name}`}
                  checked={selected.includes(layer)}
                  onChange={() => diagramSelectionStore.toggle(layer)}
                />
                <span
                  className="diagrams-tab-dot"
                  data-testid={`diagrams-tab-dot-${layer}`}
                  style={{ background: diagramAccent(layer).color }}
                />
                <span className="diagrams-tab-text">
                  <span className="diagrams-tab-name">{name}</span>
                  <span className="diagrams-tab-sub">{`${typeLabel.toLowerCase()} · ${boxCount} ${boxCount === 1 ? "box" : "boxes"}`}</span>
                </span>
                <button
                  type="button"
                  className="diagrams-tab-icon-btn"
                  aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
                  aria-pressed={hidden}
                  onClick={() => shellStore.toggleLayerHidden(layer)}
                >
                  {hidden ? "◌" : "👁"}
                </button>
                <button
                  type="button"
                  className="diagrams-tab-icon-btn"
                  aria-label={`More actions for ${name}`}
                  aria-expanded={menuLayer === layer}
                  onClick={() => setMenuLayer(menuLayer === layer ? null : layer)}
                >
                  ⋯
                </button>
                {menuLayer === layer && (
                  <button
                    type="button"
                    className="diagrams-tab-icon-btn"
                    aria-label={`Delete ${name}`}
                    onClick={() => {
                      setMenuLayer(null);
                      setDeleteError(null);
                      setDeletingLayer(layer);
                    }}
                  >
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {arrangeSlot}
      {deletingLayer && (
        <DeleteDiagramDialog
          label={diagramDisplayName(deletingLayer, doc, customTypes).name}
          note={deletingLayer.startsWith("custom/") ? "The saved diagram type itself is not affected." : undefined}
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => setDeletingLayer(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
