import type { ReactElement } from "react";
import type { C1BlockKind } from "../state/types";

export interface C1BlockIconProps {
  kind: C1BlockKind;
}

/** 14x14 glyph for one C1 diagram box or sub-block, keyed by its architectural kind — same
 * inline-SVG/currentColor convention as RailIcon/NodeKindIcon, colored per kind via
 * `.c1-block-icon-<kind>` in styles.css so the diagram reads by shape+color, not name alone. */
export function C1BlockIcon({ kind }: C1BlockIconProps) {
  return (
    <svg
      className={`c1-block-icon c1-block-icon-${kind}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
    >
      {PATHS[kind]}
    </svg>
  );
}

const PATHS: Record<C1BlockKind, ReactElement> = {
  // Two stacked server bars with status dots — the system box itself.
  system: (
    <>
      <rect x="2" y="2.3" width="12" height="4.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9.3" width="12" height="4.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4.2" cy="4.5" r="0.9" fill="currentColor" />
      <circle cx="4.2" cy="11.5" r="0.9" fill="currentColor" />
    </>
  ),
  // Head and shoulders — a human actor.
  person: (
    <>
      <circle cx="8" cy="4.6" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        d="M3 14c0-3 2.2-4.8 5-4.8s5 1.8 5 4.8"
      />
    </>
  ),
  // A boundary box with an arrow leaving its corner — a system outside our own.
  external_system: (
    <>
      <rect x="1.8" y="4.7" width="8.3" height="8.3" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.9 6.1 13.8 2.2M10.4 2.2h3.4v3.4"
      />
    </>
  ),
  // Angle brackets — a request/response interface.
  api: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 3 2.4 8 6 13M10 3l3.6 5-3.6 5"
    />
  ),
  // A window with a title bar — a user-facing surface.
  ui: (
    <>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path stroke="currentColor" strokeWidth="1.3" d="M1.8 5.9h12.4" />
      <circle cx="3.6" cy="4.35" r="0.6" fill="currentColor" />
    </>
  ),
  // A hub with radiating spokes — business logic doing work.
  service: (
    <>
      <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        d="M8 2.3v1.7M8 12v1.7M2.3 8h1.7M12 8h1.7M4.1 4.1l1.2 1.2M10.7 10.7l1.2 1.2M4.1 11.9l1.2-1.2M10.7 5.3l1.2-1.2"
      />
    </>
  ),
  // A cylinder — persistent storage.
  database: (
    <>
      <ellipse cx="8" cy="4" rx="5.2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        d="M2.8 4v8c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2V4"
      />
      <path fill="none" stroke="currentColor" strokeWidth="1.1" d="M2.8 8c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2" />
    </>
  ),
  // Two items in a lane with an arrow leaving — messages moving through a broker.
  queue: (
    <>
      <rect x="1.4" y="6" width="3" height="4" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="6.2" y="6" width="3" height="4" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M11 8h2.4" />
      <path fill="currentColor" d="M13.6 8 11.8 6.6v2.8z" />
    </>
  ),
  // A lightning bolt — fast, ephemeral access.
  cache: <path fill="currentColor" d="M9 1.5 3.6 9.2h3.1L6.2 14.5l6.2-8h-3.4L9 1.5z" />,
  // Two curved arrows forming a loop — a background job cycling on its own.
  worker: (
    <>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        d="M3.2 8a4.8 4.8 0 0 1 8.4-3.1M12.8 8a4.8 4.8 0 0 1-8.4 3.1"
      />
      <path fill="currentColor" d="M11.6 2.6v2.8h-2.8zM4.4 13.4v-2.8h2.8z" />
    </>
  ),
  // A padlock — authentication/identity.
  auth: (
    <>
      <rect x="3.4" y="7.2" width="9.2" height="6.3" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M5.3 7.2V5.3a2.7 2.7 0 0 1 5.4 0v1.9" />
    </>
  ),
};
