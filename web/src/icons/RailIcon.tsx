import type { ReactElement } from "react";

export type RailIconName =
  | "terminal"
  | "code-popup"
  | "code-inline"
  | "diff"
  | "trace"
  | "agents"
  | "pull-request"
  | "patterns"
  | "branch"
  | "epics"
  | "custom"
  | "impact"
  | "settings"
  | "report-issue"
  | "llm-providers"
  | "updates"
  | "c1"
  | "hierarchy"
  | "layer"
  | "games";

export interface RailIconProps {
  name: RailIconName;
}

/** 16x16 glyph for one left-rail control — same inline-SVG/currentColor convention as NodeKindIcon,
 * so a button's aria-pressed accent color flows straight into the icon. */
export function RailIcon({ name }: RailIconProps) {
  return (
    <svg className="rail-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

const PATHS: Record<RailIconName, ReactElement> = {
  // Window with a `>` prompt.
  terminal: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M1.65 3.15h12.7v9.7H1.65z" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        d="m4.2 6.4 1.8 1.6-1.8 1.6M8.2 10.2h3.4"
      />
    </>
  ),
  // Floating window over a dimmed backdrop — the popup code view.
  "code-popup": (
    <>
      <path fill="currentColor" opacity="0.35" d="M1 2h9v3H1z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M5.15 5.15h9.7v8.7h-9.7z" />
    </>
  ),
  // Code lines nested inside a block — the inline code view.
  "code-inline": (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M1.65 2.15h12.7v11.7H1.65z" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        d="M4.3 6h7.4M4.3 8.5h7.4M4.3 11h4.4"
      />
    </>
  ),
  // Split panes with a +/- pair — added vs removed lines.
  diff: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M8 1.5v13" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M2.5 8h3.4M4.2 6.3v3.4M10.1 8h3.4"
      />
    </>
  ),
  // Two stacked windows — the parallel agent sessions layered over the canvas.
  agents: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M1.65 2.15h9.7v7.7h-9.7z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M4.65 6.15h9.7v7.7h-9.7z" />
    </>
  ),
  // The GitHub pull-request mark: two tracks, a branch curving into the right one, an arrow head.
  "pull-request": (
    <>
      <circle cx="4" cy="3.2" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="12.8" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="3.2" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M4 4.7v6.6" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M12 4.7v4.4" />
      <path fill="currentColor" d="M12 13.1 10.1 9.6h3.8z" />
    </>
  ),
  // Play head on a track — execution-trace playback.
  trace: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" d="M1.6 8h12.8" />
      <path fill="currentColor" d="M5.6 4.2 10.9 8l-5.3 3.8z" />
    </>
  ),
  // Three connected nodes — one interface fanning out to two implementations, the Patterns view.
  patterns: (
    <>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        d="M8 4.4v2.4M8 6.8 4.2 10M8 6.8 11.8 10"
      />
      <circle cx="8" cy="3" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="3.5" cy="12" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12.5" cy="12" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  // Git branch mark — a trunk with one branch curving off, for the branch switcher.
  branch: (
    <>
      <circle cx="4" cy="3" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="13" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="3" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M4 4.6v6.8" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M4 7.4c0 2.4 8 2.4 8 0V4.6" />
    </>
  ),
  // A checklist board — three rows, one checked — for the Epics requirements view.
  epics: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M1.8 2.15h12.4v11.7H1.8z" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.6 5 .9.9L5.9 4.4"
      />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M7.4 4.9h5" />
      <rect x="3.3" y="7.5" width="1.9" height="1.9" fill="none" stroke="currentColor" strokeWidth="1" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M7.4 8.45h5" />
      <rect x="3.3" y="10.9" width="1.9" height="1.9" fill="none" stroke="currentColor" strokeWidth="1" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M7.4 11.85h5" />
    </>
  ),
  // A gear — the assistant/settings control on the rail.
  settings: (
    <>
      <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        d="M6.6 2.4l.4-1.2h2l.4 1.2 1.1.5 1.1-.5 1 1.7-.4 1.1.4 1.1-.1 1.2 1.1.9.8 1.9-1.2 1.1-.6.7.1 1.3-1.7.9-1.2-.1-1 .4-.6.7-2-.3-1.1-.3v-1.1l-1.1-.8-.9.2-1.5-.6-.3-2 .6-1.2 1-.2v-1.2l.9-1.2.9.2.8-.4z"
      />
    </>
  ),
  // A speech bubble with an exclamation mark — report a bug or suggest an idea.
  "report-issue": (
    <>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M1.8 2.6h12.4v8.4H6.9l-2.8 2.6v-2.6H1.8z"
      />
      <path fill="currentColor" d="M7.4 5h1.2v3.4H7.4z" />
      <circle cx="8" cy="9.7" r="0.75" fill="currentColor" />
    </>
  ),
  // A down arrow inside an open ring — check for and install app updates.
  updates: (
    <>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3M13.4 2.2v2.4h-2.4M8 5.6v4.2M6.2 8.2L8 10l1.8-1.8"
      />
    </>
  ),
  // A chip (the model) plugged into a socket — the LLM provider/call-site settings panel.
  "llm-providers": (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        d="M6.2 4.5V2M9.8 4.5V2M6.2 14v-2.5M9.8 14v-2.5M4.5 6.2H2M4.5 9.8H2M14 6.2h-2.5M14 9.8h-2.5"
      />
    </>
  ),
  // A dashed/user-drawn box among plain ones — a diagram type the user authored, not a fixed view.
  custom: (
    <>
      <rect
        x="1.8"
        y="1.8"
        width="5.4"
        height="5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="1.6 1.4"
      />
      <rect x="8.8" y="1.8" width="5.4" height="5.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="5.3" y="8.8" width="5.4" height="5.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  // A change radiating out: a filled seed node ringed by dependent/callee links — the Impact slice.
  impact: (
    <>
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      <circle cx="3.2" cy="3.4" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="12.8" cy="3.4" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="3.2" cy="12.6" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="12.8" cy="12.6" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5.6 4.9L6.7 6.1M10.4 4.9L9.3 6.1M5.6 11.1L6.7 9.9M10.4 11.1L9.3 9.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
  // A system boundary box with two external actors linked in — the C1 system-context picture.
  c1: (
    <>
      <rect x="4.3" y="4.3" width="7.4" height="7.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="2.2" cy="2.2" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="13.8" cy="13.8" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path fill="none" stroke="currentColor" strokeWidth="1.1" d="M3.3 3.3 4.3 4.3M12.7 12.7l1-1" />
    </>
  ),
  // A root box branching into two — the hierarchy tree, in the app's own box vocabulary (squares,
  // not circles, unlike "patterns"' fan-out).
  hierarchy: (
    <>
      <rect x="6" y="1.6" width="4" height="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.6" y="10.9" width="4" height="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10.4" y="10.9" width="4" height="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M8 4.6v3.2M8 7.8H3.6v3.1M8 7.8h4.4v3.1" />
    </>
  ),
  // Stacked planes — the generic "some layer" glyph a chip falls back to when nothing more specific
  // is known about it (a hand-authored layer, or a kind this registry hasn't caught up to yet).
  layer: (
    <>
      <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" d="M8 1.8 14.2 5 8 8.2 1.8 5z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" d="M1.8 8.4 8 11.6l6.2-3.2" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" d="M1.8 11.4 8 14.6l6.2-3.2" />
    </>
  ),
  // A joystick: a base with a stick and ball — the games panel.
  games: (
    <>
      <rect x="3" y="9.5" width="10" height="3.6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" d="M8 9.5V4.2" />
      <circle cx="8" cy="2.8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
};
