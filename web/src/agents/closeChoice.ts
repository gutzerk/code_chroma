const CLOSE_CHOICE_KEY = "codechroma.worktree-close-choice";

export type CloseChoice = "keep" | "delete";

/** The remembered "don't ask again" answer, or null to ask; storage may be blocked, so it fails open. */
export function getRememberedCloseChoice(): CloseChoice | null {
  try {
    const value = window.localStorage.getItem(CLOSE_CHOICE_KEY);
    return value === "keep" || value === "delete" ? value : null;
  } catch {
    return null;
  }
}

export function rememberCloseChoice(choice: CloseChoice | null): void {
  try {
    if (choice === null) window.localStorage.removeItem(CLOSE_CHOICE_KEY);
    else window.localStorage.setItem(CLOSE_CHOICE_KEY, choice);
  } catch {
    // Storage blocked: the dialog simply asks again next time.
  }
}
