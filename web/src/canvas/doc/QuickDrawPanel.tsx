import { useEffect, useRef, useState } from "react";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { useCustomDiagramTypes } from "./diagramCatalog";

const POLL_MS = 2000;

/** The "Quick draw" form beside the rail's "Draw…" button: pick a saved diagram type, describe the
 * process, and the bridge draws it headlessly from the local semantic context (no agent window).
 * The finished diagram reaches the canvas through the same diagram ping `DrawDiagramButton` already
 * watches, so this panel only reports progress and errors. */
export function QuickDrawPanel({ onClose }: { onClose: () => void }) {
  const engineClient = useEngineClient();
  const customTypes = useCustomDiagramTypes(engineClient);
  const [typeId, setTypeId] = useState("");
  const [request, setRequest] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const chosen = typeId || customTypes[0]?.id || "";

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const fail = (err: unknown, fallback: string) => {
    setRunning(false);
    setError(err instanceof Error ? err.message : fallback);
  };

  const settle = (status: { state: string; error?: string | null }, onDone: () => void) => {
    if (status.state === "error") fail(new Error(status.error ?? "the run failed"), "");
    else onDone();
  };

  const poll = (id: string) => {
    timer.current = window.setTimeout(() => {
      void engineClient
        .getProcessDiagramStatus(id)
        .then((status) => {
          if (status.state === "generating") poll(id);
          else settle(status, onClose);
        })
        .catch((err: unknown) => fail(err, "lost contact with the bridge"));
    }, POLL_MS);
  };

  const run = () => {
    setError(null);
    setRunning(true);
    engineClient
      .generateProcessDiagram(chosen, request.trim())
      .then((status) => settle(status, () => poll(chosen)))
      .catch((err: unknown) => fail(err, "couldn't start the run"));
  };

  return (
    <div className="quick-draw-panel" data-testid="quick-draw-panel">
      {customTypes.length === 0 ? (
        <p className="quick-draw-hint">Save a custom diagram type first; quick draw draws one of those.</p>
      ) : (
        <>
          <select aria-label="Diagram type" value={chosen} onChange={(e) => setTypeId(e.target.value)} disabled={running}>
            {customTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <textarea
            aria-label="What to draw"
            placeholder="e.g. how a client key is authorized at the gateway"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            disabled={running}
            rows={3}
          />
          <button type="button" data-testid="quick-draw-run" onClick={run} disabled={running || request.trim() === "" || chosen === ""}>
            {running ? "Drawing…" : "Draw"}
          </button>
        </>
      )}
      {error && (
        <p className="quick-draw-error" data-testid="quick-draw-error">
          {error}
        </p>
      )}
    </div>
  );
}
