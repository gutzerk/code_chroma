import { useEffect, useState, useSyncExternalStore } from "react";
import { Store } from "../state/createStore";

/** Latch-mount for a togglable panel: true from the first open onward, so the panel stays mounted
 * (hidden via CSS) and its internal state — PTY scrollback, an in-progress question or interview,
 * a dragged width — survives close/reopen. RootCanvas used to repeat this effect per panel. */
export function useLatchedMount(isOpen: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (isOpen) setMounted(true);
  }, [isOpen]);
  return mounted;
}

/** The open/closed half every dock-panel store used to re-type (research, wizard, terminal,
 * inspector all carried the same 20 lines). In-memory only, resets on reload; its singletons are
 * marked global (markGlobalStore) so panel chrome survives a workspace switch (see createStore's
 * doc). */
export class PanelStore extends Store {
  private isOpenState = false;

  getIsOpen = (): boolean => this.isOpenState;

  open = (): void => {
    this.isOpenState = true;
    this.emit();
  };

  toggle = (): void => {
    this.isOpenState = !this.isOpenState;
    this.emit();
  };

  reset: () => void = () => this.closePanel();

  // A prototype method (not an arrow property) so a subclass's own reset can still close the panel.
  protected closePanel(): void {
    this.isOpenState = false;
    this.emit();
  }
}

export function useIsPanelOpen(store: PanelStore): boolean {
  return useSyncExternalStore(store.subscribe, store.getIsOpen);
}
