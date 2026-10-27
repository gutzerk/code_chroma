import type { ReactNode } from "react";

/** One toggle pill; `pressed` marks the current choice in its row. */
export function Pill({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="llm-pill" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}
