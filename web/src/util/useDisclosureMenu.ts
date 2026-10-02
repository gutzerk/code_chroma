import { useEffect, useRef, type KeyboardEvent } from "react";

/** Shared behavior for a trigger-button + dropdown-list disclosure (BranchSwitcher,
 * CustomDiagramMenu): closes on an outside click while open, and closes plus refocuses the trigger
 * on Escape from within the list. Callers own their own `open` state — this only wires the two
 * event listeners against it. */
export function useDisclosureMenu(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open, onClose]);

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "Escape") return;
    onClose();
    triggerRef.current?.focus();
  };

  return { containerRef, triggerRef, onListKeyDown };
}
