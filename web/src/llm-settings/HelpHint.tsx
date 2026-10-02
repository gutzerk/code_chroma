import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A "?" marker whose explanation appears on hover and on keyboard focus. A real element, not a
 * `title` attribute: native tooltips are ~1s late, OS-styled, and cannot hold a list.
 *
 * 🔴 Portalled to `<body>` and positioned from the marker's own `getBoundingClientRect()`, rather
 * than an absolutely-positioned child: the Model routing table lives inside a scrolling tab panel
 * (`.llm-settings-tabpanel`), and a child-positioned bubble on a bottom row would be clipped by that
 * panel's own overflow — CSS clips an `overflow-y: auto` box on every side, not just the one axis
 * that was set. Portalling opts out of that ancestor's overflow entirely. */
export function HelpHint({
  label,
  testId,
  align = "right",
  children,
}: {
  label: string;
  testId?: string;
  /** Which edge the bubble hangs from — "right" near the panel's right edge, "left" in a table row. */
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const markerRef = useRef<HTMLButtonElement | null>(null);
  const bubbleId = `${testId ?? "help"}-bubble`;

  const show = () => {
    const rect = markerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(
      align === "right"
        ? { top: rect.bottom + 8, left: rect.right }
        : { top: rect.bottom + 8, left: rect.left },
    );
  };
  const hide = () => setPos(null);

  return (
    <span className="llm-help" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={markerRef}
        type="button"
        className="llm-help-marker"
        aria-label={label}
        aria-describedby={bubbleId}
        data-testid={testId}
        onFocus={show}
        onBlur={hide}
      >
        ?
      </button>
      {pos &&
        createPortal(
          <span
            className={`llm-help-bubble llm-help-bubble-${align}`}
            id={bubbleId}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.top,
              ...(align === "right" ? { right: window.innerWidth - pos.left } : { left: pos.left }),
            }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
