import { useEffect, useRef } from "react";
import { IS_MAC } from "../../util/platform";

/** Platform labels for the navigator's hotkeys. */
export const PROMPT_KEYS = IS_MAC
  ? { prev: "⌥↑", next: "⌥↓", alt: "⌥", find: "⌘⇧P" }
  : { prev: "Alt+↑", next: "Alt+↓", alt: "Alt", find: "Ctrl+Shift+P" };

/** Runs `effect` each time `request` changes after the first render. */
export function useOnRequest(request: number, effect: () => void): void {
  const seen = useRef(request);
  const latest = useRef(effect);
  latest.current = effect;
  useEffect(() => {
    if (request === seen.current) return;
    seen.current = request;
    latest.current();
  }, [request]);
}
