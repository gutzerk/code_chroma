import { useState } from "react";
import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { useDisclosureMenu } from "../util/useDisclosureMenu";
import { prepareCapture } from "./captureCanvas";
import { buildExport, EXPORT_FORMATS, EXPORT_META, type ExportFormat } from "./exportFormats";
import { saveFile } from "./saveFile";

export interface ShareMenuProps {
  /** Base of the suggested file name, e.g. the repository name. */
  name?: string;
}

function fileBase(name: string | undefined): string {
  const cleaned = (name ?? "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${cleaned || "canvas"}-diagram`;
}

/** The top bar's "Share" control: a dropdown of export formats (PNG, HTML, PDF); picking one renders
 * the whole diagram and opens a Save As dialog for the location and file name. */
export function ShareMenu({ name }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { containerRef, triggerRef, onListKeyDown } = useDisclosureMenu(open, () => setOpen(false));

  const exportAs = async (format: ExportFormat) => {
    setOpen(false);
    setError(null);
    const capture = prepareCapture();
    if (!capture) {
      setError("Nothing to export yet");
      return;
    }
    setBusy(true);
    try {
      const base = fileBase(name);
      const { mime, extension } = EXPORT_META[format];
      const blob = buildExport(format, capture, base).then((file) => file.blob);
      await saveFile({ name: `${base}.${extension}`, mime, blob });
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
        label={busy ? "Exporting…" : "Share"}
        className="share-menu-button"
        testId="share-menu-button"
        ariaExpanded={open}
        pressed={open || busy}
        disabled={busy}
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
      {error && (
        <div className="share-menu-error" role="alert" data-testid="share-menu-error">
          {error}
        </div>
      )}
    </div>
  );
}
