import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { CanvasElement } from "../../state/types";
import { stringMeta } from "./elementMeta";
import { buildSequenceModel } from "./sequenceModel";
import { sequenceViewStore } from "./sequenceViewStore";

const PLAYER_STEP_MS = 900;

/** The sequence header: the step player and, once any step is open, Collapse all. */
export function SequenceModeSwitch({ layer, members }: { layer: string; members: CanvasElement[] }) {
  useSyncExternalStore(sequenceViewStore.subscribe, sequenceViewStore.getVersion);
  const view = sequenceViewStore.get(layer);
  // `members` is a fresh array each render, so the order list keys on a signature of what it reads.
  const signature = members
    .map((m) => [m.id, stringMeta(m, "role"), m.meta?.order].join(":"))
    .join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` is the change signal for `members`
  const orders = useMemo(() => [...new Set(buildSequenceModel(members).messages.map((m) => m.order))], [signature]);
  const step = sequenceViewStore.getStep(layer);
  const playing = step !== null;
  // Key the timer on the order values, not the array.
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const ordersKey = orders.join(",");
  useEffect(() => {
    if (step === null) return;
    const timer = setTimeout(() => {
      const next = ordersRef.current.find((order) => order > step);
      sequenceViewStore.setStep(layer, next ?? null);
    }, PLAYER_STEP_MS);
    return () => clearTimeout(timer);
  }, [step, layer, ordersKey]);
  return (
    <span
      data-testid="sequence-mode-switch"
      style={{ marginLeft: 8, display: "inline-flex", gap: 4 }}
    >
      <button
        type="button"
        className="sequence-mode-btn"
        data-testid="sequence-play"
        onClick={() => sequenceViewStore.setStep(layer, playing ? null : (orders[0] ?? null))}
      >
        {playing ? "■ Stop" : "▶ Play"}
      </button>
      {view.expanded.length > 0 && (
        <button
          type="button"
          className="sequence-mode-btn"
          data-testid="sequence-collapse-all"
          onClick={() => sequenceViewStore.setExpanded(layer, [])}
        >
          Collapse all
        </button>
      )}
    </span>
  );
}
