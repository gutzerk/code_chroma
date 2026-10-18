/** Lesson-only: while set, a drag can only travel this way, so the tutorial can point at one direction. */
export type DragAxisLock = "up" | null;

let lock: DragAxisLock = null;

let onLockedDragEnd: (() => void) | null = null;

/** Registers who hears about a finished drag made while the lock was on. */
export function setLockedDragEndListener(listener: (() => void) | null): void {
  onLockedDragEnd = listener;
}

/** Called by the drag hook when a real drag is released. */
export function reportDragEnd(): void {
  if (lock) onLockedDragEnd?.();
}

export function setDragAxisLock(next: DragAxisLock): void {
  lock = next;
}

/** Clamps a raw drag delta (screen px) to the locked direction; unchanged when nothing is locked. */
export function applyDragAxisLock(dx: number, dy: number): { dx: number; dy: number } {
  if (lock === "up") return { dx: 0, dy: Math.min(dy, 0) };
  return { dx, dy };
}
