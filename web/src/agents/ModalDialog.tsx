import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A confirmation that outranks every agent window, and blocks the app until it is answered.
 *
 * 🔴 It is portalled to `<body>` rather than rendered where it is used: an agent window's z-index is
 * `bringToFront`'s ever-growing counter, so a dialog living inside `.agent-layer` eventually loses
 * the numbers race and paints *behind* the very window it belongs to. Out here there is no contest.
 *
 * Modal for real: focus moves in on mount and returns on unmount, Tab is trapped, Escape cancels,
 * and the backdrop swallows every click aimed at what is underneath.
 */
export function ModalDialog({
  label,
  testId,
  className,
  onDismiss,
  children,
}: {
  label: string;
  testId?: string;
  className?: string;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // Deliberately runs once: re-running on every render would yank focus back to the first control
  // each time a checkbox flips.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusables()[0] ?? dialogRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreTo?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="agent-dialog-backdrop" data-testid={testId}>
      <div
        ref={dialogRef}
        className={`agent-dialog${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
