import type { ReactNode } from "react";

/** Every glyph the workflows UI draws; inline SVG so no unicode symbol stands in for an icon. */
export type IconName =
  | "pause"
  | "play"
  | "stop"
  | "cancel"
  | "restart"
  | "trash"
  | "edit"
  | "plus"
  | "more"
  | "check"
  | "agent"
  | "review"
  | "back"
  | "circle"
  | "stopping"
  | "hold"
  | "alert"
  | "skip"
  | "chevron-up"
  | "chevron-down"
  | "redo";

const PATHS: Record<IconName, ReactNode> = {
  pause: <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" stroke="none" />,
  play: <path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" />,
  cancel: <path d="M6 6l12 12M18 6L6 18" />,
  restart: <path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" />,
  redo: <path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  agent: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z" />,
  review: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  circle: <circle cx="12" cy="12" r="7" />,
  stopping: <circle cx="12" cy="12" r="7" strokeDasharray="3 3" />,
  hold: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
  alert: <path d="M12 4v10M12 18.5v.5" strokeWidth="3" />,
  skip: <path d="M5 5l9 7-9 7zM18 5v14" />,
  "chevron-up": <path d="M6 15l6-6 6 6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
};

/** One inline SVG icon; decorative unless the caller labels the control around it. */
export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="wf-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
