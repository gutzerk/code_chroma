import { useSyncExternalStore } from "react";
import { Store } from "../../../state/createStore";

interface DrawDialogState {
  open: boolean;
  /** The card the user last picked ("last used"); null until they pick, then the dialog opens on it. */
  cardId: string | null;
  prompt: string;
  autoPrompt: string | null;
}

const INITIAL: DrawDialogState = { open: false, cardId: null, prompt: "", autoPrompt: null };

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

  pick = (cardId: string, suggestedPrompt: string): void => {
    const shouldReplacePrompt =
      this.state.prompt === "" || this.state.prompt === this.state.autoPrompt;
    this.set({
      cardId,
      prompt: shouldReplacePrompt ? suggestedPrompt : this.state.prompt,
      autoPrompt: shouldReplacePrompt ? suggestedPrompt : null,
    });
  };

  setPrompt = (prompt: string): void => this.set({ prompt, autoPrompt: null });

  /** After a successful draw: the dialog closes and the draft goes, the last-used card stays. */
  drawn = (): void => this.set({ open: false, prompt: "", autoPrompt: null });

  reset = (): void => {
    this.state = INITIAL;
    this.emit();
  };
}

export const drawDialogStore = new DrawDialogStore();

export function useDrawDialog(): DrawDialogState {
  return useSyncExternalStore(drawDialogStore.subscribe, drawDialogStore.getState);
}
