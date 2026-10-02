import { useCallback, useEffect, useMemo, useState } from "react";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { expansionStore } from "../state/expansionState";
import { traceStore, useTraceState } from "../state/traceStore";
import type { TraceFrame, TraceSummary } from "../state/types";

const SPEEDS = [0.5, 1, 2, 4];

interface StackEntry {
  nodeId: string;
  depth: number;
}

/** Reconstructs the live call stack at `stepIndex` by replaying call/return/unwind frames. */
function callStackAt(steps: TraceFrame[], stepIndex: number): StackEntry[] {
  const stack: StackEntry[] = [];
  for (let i = 0; i <= stepIndex && i < steps.length; i++) {
    const step = steps[i];
    if (!step.node_id) continue;
    if (step.event === "call") {
      stack.push({ nodeId: step.node_id, depth: step.depth });
    } else if (step.event === "return" || step.event === "unwind") {
      const idx = stack.map((e) => e.nodeId).lastIndexOf(step.node_id);
      if (idx !== -1) stack.splice(idx, 1);
    }
  }
  return stack;
}

/** The trace playback control bar: pick a recorded run, step/scrub/play through it, set breakpoints,
 * and follow the active node. Reads/writes traceStore; fetches trace summaries + steps via the
 * engine client. Rendered only while trace mode is active. */
export function TraceControls() {
  const engineClient = useEngineClient();
  const snapshot = useTraceState();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const trace = snapshot.trace;
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const total = steps.length;
  const current = snapshot.currentFrame;

  const refresh = useCallback(() => {
    void engineClient.listTraces().then(setTraces).catch(() => setTraces([]));
  }, [engineClient]);

  useEffect(() => {
    refresh();
    return engineClient.subscribeTrace(refresh);
  }, [engineClient, refresh]);

  const onPick = useCallback(
    (id: string) => {
      if (!id) return;
      void engineClient.getTrace(id).then((t) => traceStore.loadTrace(t));
    },
    [engineClient],
  );

  const currentNodeName = current?.node_id ? expansionStore.getName(current.node_id) : "—";
  // Replays the whole trace to reconstruct the stack — memoize so it only reruns when the step or
  // the trace changes, not on every store notify (speed/breakpoint/follow toggles, parent renders).
  const stack = useMemo(
    () => callStackAt(trace?.steps ?? [], snapshot.stepIndex),
    [trace, snapshot.stepIndex],
  );

  return (
    <div className="trace-controls" data-testid="trace-controls">
      <div className="trace-controls-row">
        <select
          className="trace-picker"
          aria-label="Choose a recorded trace"
          value={trace?.id ?? ""}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="">Select a trace…</option>
          {traces.map((t) => (
            <option key={t.id} value={t.id}>
              {t.status === "failed" ? "⚠ " : ""}
              {t.entry || t.id} ({t.step_count})
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Step back"
          onClick={traceStore.stepBack}
          disabled={!total || snapshot.isLive}
        >
          ◀
        </button>
        <button
          type="button"
          aria-label={snapshot.isPlaying ? "Pause" : "Play"}
          aria-pressed={snapshot.isPlaying}
          onClick={traceStore.togglePlay}
          disabled={!total || snapshot.isLive}
        >
          {snapshot.isPlaying ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          aria-label="Step forward"
          onClick={traceStore.stepForward}
          disabled={!total || snapshot.isLive}
        >
          ▶
        </button>
        <select
          className="trace-speed"
          aria-label="Playback speed"
          value={snapshot.speed}
          onChange={(e) => traceStore.setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <span className="trace-step-counter" data-testid="trace-step-counter">
          {total ? snapshot.stepIndex + 1 : 0}/{total}
        </span>
      </div>

      <div className="trace-controls-row trace-scrub-row">
        <input
          className="trace-scrub"
          type="range"
          aria-label="Scrub trace"
          min={0}
          max={Math.max(total - 1, 0)}
          value={snapshot.stepIndex}
          disabled={!total || snapshot.isLive}
          onChange={(e) => traceStore.scrubTo(Number(e.target.value))}
        />
        <div className="trace-timeline-markers" aria-hidden="true">
          {steps.map((s, i) =>
            s.event === "raise" || s.event === "unwind" ? (
              <button
                key={i}
                type="button"
                className="trace-error-marker"
                style={{ left: total > 1 ? `${(i / (total - 1)) * 100}%` : "0%" }}
                title={s.error ? `${s.error.type}: ${s.error.message}` : "error"}
                onClick={() => traceStore.scrubTo(i)}
              />
            ) : null,
          )}
        </div>
      </div>

      <div className="trace-controls-row trace-status-row">
        <span
          className={`trace-current-node${current && (current.event === "raise" || current.event === "unwind") ? " trace-current-node--error" : ""}`}
          data-testid="trace-current-node"
        >
          {currentNodeName}
          {current?.event ? ` · ${current.event}` : ""}
        </span>
        <label className="trace-follow-toggle">
          <input
            type="checkbox"
            checked={snapshot.followCamera}
            onChange={(e) => traceStore.setFollowCamera(e.target.checked)}
          />
          Follow
        </label>
        <button
          type="button"
          className="trace-breakpoint-button"
          aria-pressed={current?.node_id ? snapshot.breakpoints.has(current.node_id) : false}
          disabled={!current?.node_id}
          onClick={() => current?.node_id && traceStore.toggleBreakpoint(current.node_id)}
        >
          Breakpoint
        </button>
        <button type="button" className="trace-close-button" onClick={traceStore.clear}>
          Close
        </button>
      </div>

      {current?.error && (
        <div className="trace-error-plaque" data-testid="trace-error-plaque">
          {current.error.type}: {current.error.message}
          {current.error.handled ? " (handled)" : ""}
        </div>
      )}

      <ol className="trace-callstack" data-testid="trace-callstack">
        {stack.map((entry) => (
          <li key={`${entry.depth}:${entry.nodeId}`} style={{ paddingLeft: entry.depth * 12 }}>
            {expansionStore.getName(entry.nodeId)}
          </li>
        ))}
      </ol>
    </div>
  );
}
