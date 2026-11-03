import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import type { RawPrompt } from "../../state/types";
import { activeIndexAt, clampIndex, toPrompts, type PromptItem } from "./promptNav";

/** How long a jump's own scroll is ignored, so the active prompt does not bounce back near the end. */
export const JUMP_LOCK_MS = 250;

/** What the store drives in an agent's terminal; `xtermPromptViewport` is the real one. */
export interface PromptViewport {
  scrollToLine(line: number): void;
  scrollToBottom(): void;
  highlight(line: number | null): void;
}

/** One agent's navigator state; `current` is 1-based and 0 when there are no prompts. */
export interface PromptNavState {
  prompts: PromptItem[];
  /** Each prompt's first buffer line, null once it has left the terminal history. */
  lines: (number | null)[];
  totalLines: number;
  current: number;
  /** Text for the aria-live region after a jump. */
  announce: string;
  /** Bumped by Cmd/Ctrl+Shift+P: the outline focuses its search, the compact bar opens its list. */
  findRequest: number;
}

const EMPTY: PromptNavState = { prompts: [], lines: [], totalLines: 0, current: 0, announce: "", findRequest: 0 };

function samePrompts(a: readonly PromptItem[], b: readonly PromptItem[]): boolean {
  return a.length === b.length && a.every((p, i) => p.id === b[i].id && p.text === b[i].text && p.summary === b[i].summary);
}

/** Per-agent prompt navigation, kept across agent switches so each agent remembers its place. */
class PromptNavStore extends Store {
  private states = new Map<string, PromptNavState>();
  private viewports = new Map<string, PromptViewport>();
  private lockUntil = new Map<string, number>();

  get = (agentId: string): PromptNavState => this.states.get(agentId) ?? EMPTY;

  private set(agentId: string, patch: Partial<PromptNavState>): void {
    const prev = this.get(agentId);
    const next = { ...prev, ...patch };
    this.states.set(agentId, next);
    if (next.current !== prev.current || next.lines !== prev.lines) this.highlight(agentId);
    this.emit();
  }

  private highlight(agentId: string): void {
    const { current, lines } = this.get(agentId);
    this.viewports.get(agentId)?.highlight(current > 0 ? (lines[current - 1] ?? null) : null);
  }

  setPrompts = (agentId: string, raw: readonly RawPrompt[]): void => {
    const prev = this.get(agentId);
    const prompts = toPrompts(raw);
    if (samePrompts(prev.prompts, prompts)) return;
    const current = prev.current === 0 ? prompts.length : clampIndex(prev.current, prompts.length);
    this.set(agentId, { prompts, current });
  };

  /** The terminal's latest scan: where each prompt sits and how long the buffer is. */
  setLayout = (agentId: string, lines: (number | null)[], totalLines: number): void => {
    const prev = this.get(agentId);
    const same = prev.totalLines === totalLines && prev.lines.length === lines.length && prev.lines.every((l, i) => l === lines[i]);
    if (!same) this.set(agentId, { lines, totalLines });
  };

  /** A user scroll: the active prompt follows the viewport, except during a jump's own scroll. */
  onViewport = (agentId: string, viewportTop: number): void => {
    if (Date.now() < (this.lockUntil.get(agentId) ?? 0)) return;
    const { lines, current } = this.get(agentId);
    if (lines.length === 0) return;
    const next = activeIndexAt(lines, viewportTop);
    if (next !== current) this.set(agentId, { current: next });
  };

  go = (agentId: string, index: number): void => {
    const { prompts, lines } = this.get(agentId);
    const current = clampIndex(index, prompts.length);
    if (current === 0) return;
    const line = lines[current - 1] ?? null;
    this.lockUntil.set(agentId, Date.now() + JUMP_LOCK_MS);
    if (line !== null) this.viewports.get(agentId)?.scrollToLine(line);
    const where = line === null ? " (not found in the terminal)" : "";
    this.set(agentId, { current, announce: `Prompt ${current} of ${prompts.length}${where}` });
  };

  step = (agentId: string, delta: 1 | -1): void => {
    const { current } = this.get(agentId);
    if (current > 0) this.go(agentId, current + delta);
  };

  latest = (agentId: string): void => {
    this.viewports.get(agentId)?.scrollToBottom();
  };

  requestFind = (agentId: string): void => {
    this.set(agentId, { findRequest: this.get(agentId).findRequest + 1 });
  };

  /** Drops the state of agents that no longer exist. */
  retain = (agentIds: readonly string[]): void => {
    const keep = new Set(agentIds);
    const gone = [...this.states.keys()].filter((id) => !keep.has(id));
    if (gone.length === 0) return;
    gone.forEach((id) => {
      this.states.delete(id);
      this.lockUntil.delete(id);
    });
    this.emit();
  };

  /** Registers the agent's terminal; returns the detach. */
  attach = (agentId: string, viewport: PromptViewport): (() => void) => {
    this.viewports.set(agentId, viewport);
    this.highlight(agentId);
    return () => {
      if (this.viewports.get(agentId) === viewport) this.viewports.delete(agentId);
    };
  };

  reset(): void {
    this.states = new Map();
    this.lockUntil = new Map();
    this.emit();
  }
}

export const promptNavStore = new PromptNavStore().markGlobalStore();

export function usePromptNav(agentId: string): PromptNavState {
  return useSyncExternalStore(promptNavStore.subscribe, () => promptNavStore.get(agentId));
}

/** Whether the agent has any prompts; re-renders only when that flips, not on every buffer scan. */
export function useHasPrompts(agentId: string): boolean {
  return useSyncExternalStore(promptNavStore.subscribe, () => promptNavStore.get(agentId).prompts.length > 0);
}
