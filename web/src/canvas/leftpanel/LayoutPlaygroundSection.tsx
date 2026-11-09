import { useState } from "react";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import {
  changedTuning,
  layoutTuningStore,
  useLayoutTuning,
  type LayoutDirection,
  type LayoutTuning,
} from "../connectors/layoutTuning";
import { redrawLayerFromScratch } from "../doc/diagramCatalog";
import { diagramSelectionStore, useSelectedDiagrams } from "./diagramSelectionStore";
import { addSampleDiagram, SAMPLE_LAYER } from "./layoutPlaygroundSample";
import "./LayoutPlaygroundSection.css";

type NumberKey = {
  [K in keyof LayoutTuning]: LayoutTuning[K] extends number ? K : never;
}[keyof LayoutTuning];

const NUMBER_FIELDS: { key: NumberKey; label: string; step?: number }[] = [
  { key: "nodeSep", label: "Node gap (in layer)" },
  { key: "rankSep", label: "Layer gap" },
  { key: "componentSep", label: "Component gap" },
  { key: "margin", label: "Padding" },
  { key: "aspectRatio", label: "Aspect ratio", step: 0.1 },
  { key: "newDiagramGap", label: "Gap below canvas" },
  { key: "defaultWidth", label: "Default box width" },
  { key: "defaultHeight", label: "Default box height" },
  { key: "incrementalNodeSep", label: "Incremental gap X" },
  { key: "incrementalRankSep", label: "Incremental gap Y" },
];

const DIRECTIONS: LayoutDirection[] = ["auto", "DOWN", "RIGHT", "UP", "LEFT"];
const NODE_PLACEMENTS = ["", "BRANDES_KOEPF", "NETWORK_SIMPLEX", "LINEAR_SEGMENTS", "SIMPLE"];
const CROSSING_MINIMIZATIONS = ["", "LAYER_SWEEP", "INTERACTIVE", "NONE"];

/** Dev-only knobs for the first layout plus a button that redraws the ticked diagrams from scratch. */
export function LayoutPlaygroundSection() {
  const engineClient = useEngineClient();
  const tuning = useLayoutTuning();
  const selected = useSelectedDiagrams();
  const [keepPlace, setKeepPlace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const changedCount = Object.keys(changedTuning(tuning)).length;

  const relayout = async () => {
    const layers = [...selected];
    setBusy(true);
    setStatus(null);
    try {
      // One at a time: each fresh draw stacks below whatever is already on the canvas.
      for (const layer of layers) {
        const result = await redrawLayerFromScratch(engineClient, layer, { keepPlace });
        if (!result.ok) {
          setStatus(`${layer}: ${result.error}`);
          return;
        }
        if (!diagramSelectionStore.isSelected(layer)) diagramSelectionStore.toggle(layer);
      }
      setStatus(`Re-laid out ${layers.length}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "re-layout failed");
    } finally {
      setBusy(false);
    }
  };

  const addSample = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await addSampleDiagram(engineClient);
      if (!result.ok) setStatus(result.error);
      else if (!diagramSelectionStore.isSelected(SAMPLE_LAYER)) diagramSelectionStore.toggle(SAMPLE_LAYER);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "sample add failed");
    } finally {
      setBusy(false);
    }
  };

  const copyChanges = () => {
    const text = JSON.stringify(changedTuning(tuning), null, 2);
    try {
      void navigator.clipboard.writeText(text).then(
        () => setStatus("Copied changed values"),
        () => setStatus(text),
      );
    } catch {
      setStatus(text);
    }
  };

  return (
    <section className="layout-playground" data-testid="layout-playground" aria-label="Layout playground">
      <div className="layout-playground-head">
        <span className="arrange-section-label">{`Layout playground · ${changedCount} changed`}</span>
        <button
          type="button"
          className="left-panel-icon-btn"
          aria-label="Close layout playground"
          onClick={() => layoutTuningStore.setEnabled(false)}
        >
          ×
        </button>
      </div>
      <div className="layout-playground-grid">
        <label>
          Direction
          <select
            value={tuning.direction}
            onChange={(e) => layoutTuningStore.update({ direction: e.target.value as LayoutDirection })}
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        {NUMBER_FIELDS.map(({ key, label, step }) => (
          <label key={key}>
            {label}
            <input
              type="number"
              step={step ?? 10}
              value={tuning[key]}
              onChange={(e) => {
                const value = Number.parseFloat(e.target.value);
                if (Number.isFinite(value)) layoutTuningStore.update({ [key]: value });
              }}
            />
          </label>
        ))}
        <label>
          Node placement
          <select
            value={tuning.nodePlacement}
            onChange={(e) => layoutTuningStore.update({ nodePlacement: e.target.value })}
          >
            {NODE_PLACEMENTS.map((v) => (
              <option key={v} value={v}>{v || "ELK default"}</option>
            ))}
          </select>
        </label>
        <label>
          Crossing minimization
          <select
            value={tuning.crossingMinimization}
            onChange={(e) => layoutTuningStore.update({ crossingMinimization: e.target.value })}
          >
            {CROSSING_MINIMIZATIONS.map((v) => (
              <option key={v} value={v}>{v || "ELK default"}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="layout-playground-check">
        <input
          type="checkbox"
          checked={tuning.separateComponents}
          onChange={(e) => layoutTuningStore.update({ separateComponents: e.target.checked })}
        />
        Separate connected components
      </label>
      <label className="layout-playground-extra">
        Extra ELK options (key=value per line)
        <textarea
          rows={3}
          spellCheck={false}
          placeholder="elk.layered.wrapping.strategy=MULTI_EDGE"
          value={tuning.extraElkOptions}
          onChange={(e) => layoutTuningStore.update({ extraElkOptions: e.target.value })}
        />
      </label>
      <label className="layout-playground-check">
        <input type="checkbox" checked={keepPlace} onChange={(e) => setKeepPlace(e.target.checked)} />
        Keep the diagram in place
      </label>
      <button
        type="button"
        className="arrange-section-button layout-playground-run"
        disabled={busy || selected.length === 0}
        onClick={() => void relayout()}
      >
        {busy ? "Laying out…" : `Re-layout selected from scratch · ${selected.length}`}
      </button>
      <div className="arrange-section-buttons">
        <button type="button" className="arrange-section-button" disabled={busy} onClick={() => void addSample()}>
          Add sample
        </button>
        <button type="button" className="arrange-section-button" onClick={layoutTuningStore.resetTuning}>
          Reset
        </button>
        <button type="button" className="arrange-section-button" onClick={copyChanges}>
          Copy changes
        </button>
      </div>
      {status && (
        <pre className="layout-playground-status" role="status">
          {status}
        </pre>
      )}
    </section>
  );
}
