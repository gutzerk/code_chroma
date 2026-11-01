import { useSyncExternalStore } from "react";
import { Store } from "../../../state/createStore";

interface DrawDialogState {
  open: boolean;
  /** The card the user last picked ("last used"); null until they pick, then the dialog opens on it. */
  cardId: string | null;
  prompt: string;
}

const INITIAL: DrawDialogState = { open: false, cardId: null, prompt: "" };

/** The Draw dialog's open flag, last-used card and draft; the draft survives close/reopen until drawn. */
class DrawDialogStore extends Store {
  private state: DrawDialogState = INITIAL;

  getState = (): DrawDialogState => this.state;

  private set(patch: Partial<DrawDialogState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  open = (): void => this.set({ open: true });

  close = (): void => this.set({ open: false });

  pick = (cardId: string): void => this.set({ cardId });

  setPrompt = (prompt: string): void => this.set({ prompt });

  /** After a successful draw: the dialog closes and the draft goes, the last-used card stays. */
  drawn = (): void => this.set({ open: false, prompt: "" });

  reset = (): void => {
    this.state = INITIAL;
    this.emit();
  };
}

export const drawDialogStore = new DrawDialogStore();

export function useDrawDialog(): DrawDialogState {
  return useSyncExternalStore(drawDialogStore.subscribe, drawDialogStore.getState);
}
