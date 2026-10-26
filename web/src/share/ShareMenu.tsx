import { useEffect, useState } from "react";
import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { useDisclosureMenu } from "../util/useDisclosureMenu";
import { prepareCapture } from "./captureCanvas";
import { buildExport, EXPORT_FORMATS, EXPORT_META, type ExportFormat } from "./exportFormats";
import { saveFile } from "./saveFile";

export interface ShareMenuProps {
  /** Base of the suggested file name, e.g. the repository name. */
  name?: string;
  /** The diagram layers to export; the control is disabled while the list is empty. */
  layers: readonly string[];
}

function fileBase(name: string | undefined): string {
  const cleaned = (name ?? "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${cleaned || "canvas"}-diagram`;
}

/** The Diagrams panel's "Export" control: a dropdown of export formats (PNG, HTML, PDF); picking one renders
 * the selected diagrams and opens a Save As dialog for the location and file name. */
export function ShareMenu({ name, layers }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const { containerRef, triggerRef, onListKeyDown } = useDisclosureMenu(open, () => setOpen(false));

  useEffect(() => {
    if (!savedName) return;
    const timer = setTimeout(() => setSavedName(null), 4000);
    return () => clearTimeout(timer);
  }, [savedName]);

  const exportAs = async (format: ExportFormat) => {
    setOpen(false);
    setError(null);
    setSavedName(null);
    const capture = prepareCapture(document, layers);
    if (!capture) {
      setError("Nothing to export yet");
      return;
    }
    setBusy(true);
    try {
      const base = fileBase(name);
      const { mime, extension } = EXPORT_META[format];
      const blob = buildExport(format, capture, base).then((file) => file.blob);
      const fileName = `${base}.${extension}`;
      if (await saveFile({ name: fileName, mime, blob })) setSavedName(fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share-menu" ref={containerRef}>
      <RailButton
        ref={triggerRef}
        label={busy ? "Exporting…" : "Export"}
        tooltip={layers.length === 0 ? "Tick diagrams to export" : undefined}
        className="share-menu-button"
        testId="share-menu-button"
        ariaExpanded={open}
        pressed={open || busy}
        disabled={busy || layers.length === 0}
        onClick={() => setOpen((current) => !current)}
      >
        <RailIcon name="share" />
      </RailButton>
      {open && (
        <ul className="share-menu-list" data-testid="share-menu-list" onKeyDown={onListKeyDown}>
          {EXPORT_FORMATS.map((format) => (
            <li key={format.id}>
              <button
                type="button"
                className="share-menu-item"
                data-testid={`share-menu-item-${format.id}`}
                onClick={() => void exportAs(format.id)}
              >
                {format.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {savedName && (
        <div className="share-menu-error share-menu-success" role="status" data-testid="share-menu-success">
          {`Exported ${savedName}`}
        </div>
      )}
      {error && (
        <div className="share-menu-error" role="alert" data-testid="share-menu-error">
          {error}
        </div>
      )}
    </div>
  );
}
