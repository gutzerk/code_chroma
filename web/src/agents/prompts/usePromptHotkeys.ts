import { useEffect } from "react";
import { promptNavStore } from "./promptNavStore";

/** The attribute that scopes the hotkeys: focus must be inside an element carrying the agent's id. */
export const PROMPT_NAV_SCOPE = "data-prompt-nav-agent";

/** Which navigator action a keydown asks for, or null. */
export function promptHotkey(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "key" | "code">): "prev" | "next" | "find" | null {
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (event.key === "ArrowUp") return "prev";
    if (event.key === "ArrowDown") return "next";
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && (event.code === "KeyP" || event.key.toLowerCase() === "p")) return "find";
  return null;
}

/** Other text fields keep their own Alt+arrows; the terminal's input and the prompt search do not. */
function isForeignField(el: Element): boolean {
  if (el.classList.contains("xterm-helper-textarea") || el.hasAttribute("data-prompt-search")) return false;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

function onKeyDown(event: KeyboardEvent): void {
  const action = promptHotkey(event);
  if (!action || event.isComposing || !(event.target instanceof Element)) return;
  const agentId = event.target.closest(`[${PROMPT_NAV_SCOPE}]`)?.getAttribute(PROMPT_NAV_SCOPE);
  if (!agentId || isForeignField(event.target) || document.querySelector('[aria-modal="true"]')) return;
  if (promptNavStore.get(agentId).prompts.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (action === "find") promptNavStore.requestFind(agentId);
  else promptNavStore.step(agentId, action === "prev" ? -1 : 1);
}

let users = 0;

/** One window listener however many panels use it, so a keypress never steps twice. */
export function usePromptHotkeys(): void {
  useEffect(() => {
    if (users++ === 0) window.addEventListener("keydown", onKeyDown, true);
    return () => {
      if (--users === 0) window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
