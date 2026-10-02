import type { LayoutKind } from "./types";
import type { Offset } from "../canvas/useDragOffset";
import { Store } from "./createStore";

/** How many committed drags we remember per diagram — matches the "cancel the last 10 moves"
 * requirement. Oldest entries fall off a kind's history as new ones are recorded. */
export const UNDO_LIMIT = 10;

type OffsetMap = Record<string, Offset>;

/**
 * The undo history for layout drags, scoped per diagram kind — one stack each for c1, patterns,
 * epics, hierarchy, plus one per `` `custom/${typeId}` `` (feature 011: an open-ended family, so it
 * can't be a fixed-key Record like the others — a Map with lazy per-key creation covers every kind
 * uniformly). Each recorded entry is the layout's PRE-commit state (what undoing must restore), so
 * the very first drag of a diagram still undoes back to the fetched baseline with no extra
 * bookkeeping. Shared across view switches on purpose: UndoManager pops the active kind's stack, so
 * it's marked global (markGlobalStore) and switching diagrams or a workspace never clears it.
 */
interface UndoEntry {
  seq: number;
  layout: OffsetMap;
}

export class UndoStore extends Store {
  private history = new Map<LayoutKind, UndoEntry[]>();
  // Monotonic across every kind, not per-kind -- undoLatest needs one shared clock to compare "was
  // the last hierarchy drag or the last canvas drag more recent" across two separate stacks.
  private sequence = 0;

  private stackFor(kind: LayoutKind): UndoEntry[] {
    let stack = this.history.get(kind);
    if (!stack) {
      stack = [];
      this.history.set(kind, stack);
    }
    return stack;
  }

  // Read-only on purpose: `stackFor` lazily creates a kind's entry, and with the open-ended
  // `` `custom/${typeId}` `` family a mere "can I undo?" check (e.g. rendering a disabled button)
  // must never permanently plant a dead empty array in `history` for every type a user ever views.
  canUndo = (kind: LayoutKind): boolean => (this.history.get(kind)?.length ?? 0) > 0;

  /** Records the state to restore after one undoable drag: the layout map as it stood BEFORE the
   * commit, so undoing this action returns the boxes there. */
  recordCommit = (kind: LayoutKind, layout: OffsetMap): void => {
    const stack = this.stackFor(kind);
    stack.push({ seq: ++this.sequence, layout });
    if (stack.length > UNDO_LIMIT) stack.shift();
    this.emit();
  };

  /** Pops and returns the layout to restore for `kind`, or null when that kind has nothing to undo.
   * Read-only when there's nothing to pop — same reasoning as `canUndo`. */
  undo = (kind: LayoutKind): OffsetMap | null => {
    const entry = this.history.get(kind)?.pop() ?? null;
    if (entry !== null) this.emit();
    return entry?.layout ?? null;
  };

  /** Pops whichever of `kinds` recorded the most recent commit, or null if none of them has
   * anything to undo -- lets one Ctrl+Z undo the true last action on a canvas where more than one
   * kind of box (e.g. hierarchy and canvas-doc boxes) can be dragged side by side. */
  undoLatest = (kinds: readonly LayoutKind[]): { kind: LayoutKind; layout: OffsetMap } | null => {
    let best: { kind: LayoutKind; seq: number } | null = null;
    for (const kind of kinds) {
      const top = this.history.get(kind)?.at(-1);
      if (top && (!best || top.seq > best.seq)) best = { kind, seq: top.seq };
    }
    if (!best) return null;
    const entry = this.history.get(best.kind)!.pop()!;
    this.emit();
    return { kind: best.kind, layout: entry.layout };
  };

  reset = (): void => {
    this.history = new Map();
    this.sequence = 0;
    this.emit();
  };
}

export const undoStore = new UndoStore().markGlobalStore();
