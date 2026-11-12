/** How long after a wheel or key press a scroll still counts as the user's. */
const INTENT_MS = 300;

interface Disposable {
  dispose(): void;
}

/** The slice of an xterm Terminal the pin needs; a fake in tests. */
export interface StickyTerminal {
  buffer: { active: { viewportY: number; baseY: number } };
  onScroll(cb: () => void): Disposable;
  onWriteParsed(cb: () => void): Disposable;
  scrollToBottom(): void;
}

export interface StickToBottomHandle {
  /** The host box was shown again: a pinned terminal goes back to the bottom. */
  shown(): void;
  detach(): void;
}

/** True when the viewport shows the last line of output. */
export function isAtBottom(term: Pick<StickyTerminal, "buffer">): boolean {
  return term.buffer.active.viewportY >= term.buffer.active.baseY;
}

const pins = new WeakMap<StickyTerminal, (pinned: boolean) => void>();

/** A deliberate jump up (prompt navigator): the terminal stops following output. */
export function unpinTerminal(term: StickyTerminal): void {
  pins.get(term)?.(false);
}

/** A deliberate jump to the end (Latest): the terminal follows output again. */
export function pinTerminal(term: StickyTerminal): void {
  pins.get(term)?.(true);
}

/** Keeps a terminal at the bottom unless the user scrolled away: a stale xterm scrollbar event during a big redraw must not strand it a few screens up. */
export function attachStickToBottom(term: StickyTerminal, host: HTMLElement, isHidden: () => boolean): StickToBottomHandle {
  let pinned = true;
  let pointerHeld = false;
  let intentUntil = 0;

  const atBottom = () => isAtBottom(term);
  const follow = () => { if (pinned && !atBottom()) term.scrollToBottom(); };
  const userIntent = () => pointerHeld || Date.now() < intentUntil;
  const markIntent = () => { intentUntil = Date.now() + INTENT_MS; };
  const onPointerDown = () => { pointerHeld = true; };
  const onPointerUp = () => {
    if (!pointerHeld) return;
    pointerHeld = false;
    markIntent();
  };

  const settle = () => {
    if (isHidden()) return;
    if (userIntent()) pinned = atBottom();
    else follow();
  };

  pins.set(term, (next) => {
    pinned = next;
    follow();
  });
  host.addEventListener("wheel", markIntent, { passive: true });
  host.addEventListener("keydown", markIntent);
  host.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  const scrolls = term.onScroll(settle);
  const writes = term.onWriteParsed(settle);

  return {
    shown: follow,
    detach: () => {
      pins.delete(term);
      host.removeEventListener("wheel", markIntent);
      host.removeEventListener("keydown", markIntent);
      host.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      scrolls.dispose();
      writes.dispose();
    },
  };
}
