import { useSyncExternalStore } from "react";
import type { Trace, TraceFrame } from "./types";
import { Store } from "./createStore";

const BASE_STEP_MS = 700;

/** Snapshot the overlay/controls render from — a stable (===) object rebuilt once per mutation so
 * useSyncExternalStore never loops on a fresh reference each read. */
export interface TraceSnapshot {
  trace: Trace | null;
  stepIndex: number;
  isPlaying: boolean;
  isActive: boolean;
  isLive: boolean;
  followCamera: boolean;
  speed: number;
  breakpoints: ReadonlySet<string>;
  currentFrame: TraceFrame | null;
}

const EMPTY_SNAPSHOT: TraceSnapshot = {
  trace: null,
  stepIndex: 0,
  isPlaying: false,
  isActive: false,
  isLive: false,
  followCamera: true,
  speed: 1,
  breakpoints: new Set(),
  currentFrame: null,
};

/** Global execution-trace playback store: active trace, current step, play/scrub/speed/breakpoints.
 * In-memory only (FR-018), same version-counter + stable-snapshot shape as the other stores. The
 * player advances stepIndex on a timer, pausing at end / on a breakpoint node / on a failed trace's
 * culprit frame. Live mode appends streamed frames and disables scrubbing until the run ends. */
class TraceStore extends Store {
  private trace: Trace | null = null;
  private stepIndex = 0;
  private isPlaying = false;
  private isActive = false;
  private isLive = false;
  private followCamera = true;
  private speed = 1;
  private breakpoints = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: TraceSnapshot = EMPTY_SNAPSHOT;
  // Index of the frame playback pauses on for a failed trace (last unhandled raise). Cached because
  // it's fixed for a loaded trace — recomputed only when the trace/its status changes, not per tick.
  private culprit = -1;

  getSnapshot = (): TraceSnapshot => this.snapshot;

  private rebuild(): void {
    const steps = this.trace?.steps ?? [];
    this.snapshot = {
      trace: this.trace,
      stepIndex: this.stepIndex,
      isPlaying: this.isPlaying,
      isActive: this.isActive,
      isLive: this.isLive,
      followCamera: this.followCamera,
      speed: this.speed,
      breakpoints: new Set(this.breakpoints),
      currentFrame: steps[this.stepIndex] ?? null,
    };
  }

  private notify(): void {
    this.rebuild();
    this.emit();
  }

  private recomputeCulprit(): void {
    const steps = this.trace?.steps ?? [];
    if (this.trace?.status !== "failed" || steps.length === 0) {
      this.culprit = -1;
      return;
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].event === "raise") {
        this.culprit = i;
        return;
      }
    }
    this.culprit = steps.length - 1;
  }

  loadTrace = (trace: Trace): void => {
    this.stopTimer();
    // Tolerate a malformed trace file whose `steps` isn't an array — never let the UI call .map/.length on a non-list.
    this.trace = { ...trace, steps: Array.isArray(trace.steps) ? trace.steps : [] };
    this.stepIndex = 0;
    this.isPlaying = false;
    this.isActive = true;
    this.isLive = false;
    this.recomputeCulprit();
    this.notify();
  };

  /** Begins a live run only if one isn't already active — lets a stream that reconnected past its
   * trace-start (or a page opened mid-run) still render steps instead of silently dropping them. */
  ensureLive = (id: string, entry = ""): void => {
    if (this.isLive) return;
    this.startLive(id, entry);
  };

  /** Begins a live run: an empty trace that appendStep() fills as frames stream in. */
  startLive = (id: string, entry = ""): void => {
    this.stopTimer();
    this.trace = { id, entry, created_at: "", status: "ok", steps: [] };
    this.stepIndex = 0;
    this.isPlaying = false;
    this.isActive = true;
    this.isLive = true;
    this.culprit = -1;
    this.notify();
  };

  appendStep = (frame: TraceFrame): void => {
    if (!this.trace || !this.isLive) return;
    this.trace.steps.push(frame);
    this.stepIndex = this.trace.steps.length - 1;
    if (frame.error && !frame.error.handled) this.trace.status = "failed";
    this.recomputeCulprit();
    this.notify();
  };

  endLive = (status: "ok" | "failed"): void => {
    if (!this.trace) return;
    this.trace.status = status;
    this.isLive = false;
    this.recomputeCulprit();
    this.notify();
  };

  clear = (): void => {
    this.stopTimer();
    this.trace = null;
    this.stepIndex = 0;
    this.isPlaying = false;
    this.isActive = false;
    this.isLive = false;
    this.culprit = -1;
    this.notify();
  };

  /** Opens the trace control bar without a trace loaded yet — the picker fills it. */
  activate = (): void => {
    this.isActive = true;
    this.notify();
  };

  private clampIndex(index: number): number {
    const last = (this.trace?.steps.length ?? 0) - 1;
    if (last < 0) return 0;
    return Math.min(Math.max(index, 0), last);
  }

  stepForward = (): void => {
    if (this.isLive) return;
    this.stepIndex = this.clampIndex(this.stepIndex + 1);
    this.notify();
  };

  stepBack = (): void => {
    if (this.isLive) return;
    this.stepIndex = this.clampIndex(this.stepIndex - 1);
    this.notify();
  };

  scrubTo = (index: number): void => {
    if (this.isLive) return;
    this.stepIndex = this.clampIndex(index);
    this.notify();
  };

  setSpeed = (speed: number): void => {
    this.speed = speed;
    if (this.isPlaying) this.scheduleTick();
    this.notify();
  };

  setFollowCamera = (follow: boolean): void => {
    this.followCamera = follow;
    this.notify();
  };

  toggleBreakpoint = (nodeId: string): void => {
    if (this.breakpoints.has(nodeId)) this.breakpoints.delete(nodeId);
    else this.breakpoints.add(nodeId);
    this.notify();
  };

  play = (): void => {
    if (this.isLive) return;
    const last = (this.trace?.steps.length ?? 0) - 1;
    if (last < 0) return;
    if (this.stepIndex >= last) this.stepIndex = 0;
    this.isPlaying = true;
    this.scheduleTick();
    this.notify();
  };

  pause = (): void => {
    this.isPlaying = false;
    this.stopTimer();
    this.notify();
  };

  togglePlay = (): void => {
    if (this.isPlaying) this.pause();
    else this.play();
  };

  private scheduleTick(): void {
    this.stopTimer();
    this.timer = setTimeout(this.tick, BASE_STEP_MS / this.speed);
  }

  private tick = (): void => {
    const steps = this.trace?.steps ?? [];
    const last = steps.length - 1;
    if (last < 0) {
      this.pause();
      return;
    }
    const next = this.stepIndex + 1;
    if (next > last) {
      this.pause();
      return;
    }
    this.stepIndex = next;
    const frame = steps[next];
    const hitBreakpoint = frame?.node_id != null && this.breakpoints.has(frame.node_id);
    if (hitBreakpoint || (this.culprit >= 0 && next >= this.culprit)) {
      this.pause();
      return;
    }
    this.notify();
    this.scheduleTick();
  };

  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  reset = (): void => {
    this.breakpoints.clear();
    this.followCamera = true;
    this.speed = 1;
    this.clear();
  };
}

export const traceStore = new TraceStore();

export function useTraceState(): TraceSnapshot {
  return useSyncExternalStore(traceStore.subscribe, traceStore.getSnapshot);
}
