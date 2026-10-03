import type { ReactNode } from "react";
import type { C1BlockKind, CanvasElement } from "../../state/types";
import { BrandIcon } from "../../icons/BrandIcon";
import { ALL_BRAND_ICONS } from "../../icons/brands";
import { C1BlockIcon } from "../../icons/C1BlockIcon";
import { groupColorIndex } from "./groupColor";
import { stringMeta } from "./elementMeta";

export interface NodeAccent {
  icon?: ReactNode;
  className?: string;
}

export const NO_ACCENT: NodeAccent = {};

// The only kinds C1BlockIcon actually has a glyph for; a kind outside this set (patterns'
// "infra"/"external", a custom type's own free-form vocabulary) renders no icon at all, never an
// empty placeholder -- see C1BlockIcon.tsx's PATHS map.
const C1_BLOCK_KINDS = new Set<C1BlockKind>([
  "system", "person", "external_system", "api", "ui", "service",
  "database", "queue", "cache", "worker", "auth",
]);

/** A recognized brand slug wins over `kind`; a `kind` C1BlockIcon doesn't recognize renders nothing
 * (never an empty placeholder) -- applies to every render kind now, not just c1. */
function iconFor(element: CanvasElement): ReactNode | undefined {
  const icon = stringMeta(element, "icon");
  if (icon && icon in ALL_BRAND_ICONS) return <BrandIcon slug={icon} />;
  const kind = stringMeta(element, "kind");
  if (kind && C1_BLOCK_KINDS.has(kind as C1BlockKind)) return <C1BlockIcon kind={kind as C1BlockKind} />;
  return undefined;
}

/** Namespaced per render kind (`${render}-node-kind-${kind}`, not a bare `pattern-node-kind-...`)
 * so a custom type's own free-form `kind` vocabulary can never collide with patterns' unscoped
 * `.pattern-node-kind-infra`/`.pattern-node-kind-external` CSS rules. */
function kindClassName(element: CanvasElement): string | undefined {
  const kind = stringMeta(element, "kind");
  return kind ? `${element.render}-node-kind-${kind}` : undefined;
}

/** Impact's authored `"new"` status (drawing-rules.md) renders identically to the "changes" overlay's
 * git-derived `"added"` -- one alias here beats teaching CSS a second token. `"deleted"` is NOT
 * aliased to the overlay's `"removed"`: `"removed"` means the box's own entity is gone (struck-
 * through, faded -- see styles.css), but an authored `"deleted"` box is a surviving file/dir ancestor
 * that still exists, just with something removed from inside it -- it needs its own, milder rule. */
const STATUS_CLASS_ALIASES: Record<string, string> = { new: "added" };

/** `.block-change--<status> > .block-row` already targets every box kind's shared `.block-row`
 * class (see elementRules.ts), so this generalizes with no new CSS needed. */
function statusClassName(element: CanvasElement): string | undefined {
  const status = stringMeta(element, "status");
  if (!status) return undefined;
  return `block-change--${STATUS_CLASS_ALIASES[status] ?? status}`;
}

function groupClassName(element: CanvasElement): string | undefined {
  const group = stringMeta(element, "group");
  return group ? `custom-node-group-${groupColorIndex(group)}` : undefined;
}

export const NO_CODE_REASON_LABELS: Record<string, string> = {
  conceptual: "CONCEPTUAL",
  unresolved: "UNRESOLVED",
};

/** Drives the solid-border "ghost" accent (frame color + transparent fill + italic title, see
 * styles.css) for a resolver-stamped no-code box; "planned" keeps its own `NodeTopBand` treatment
 * instead, so it's deliberately absent from this map. */
function noCodeReasonClassName(element: CanvasElement): string | undefined {
  const reason = stringMeta(element, "no_code_reason");
  return reason && reason in NO_CODE_REASON_LABELS ? `no-code-${reason}` : undefined;
}

/**
 * One accent decision per box -- icon and/or CSS classes -- applying every rule (icon-by-brand,
 * kind-by-icon/class, status-by-class, group-by-class) to any node regardless of its render kind
 * (036-shared-diagram-style-catalog Decision 7), replacing the four per-kind branches this used to
 * carry. A rule that finds nothing for a given node contributes nothing, so a diagram type that
 * never sets `meta.status`/`meta.group` looks exactly as it did before this unification -- only a
 * type that starts using a shared field gains the accent that goes with it. Pure function of
 * `element`; see contracts/diagram-schema.md.
 */
export function accentFor(element: CanvasElement): NodeAccent {
  const icon = iconFor(element);
  const classNames = [
    kindClassName(element),
    statusClassName(element),
    groupClassName(element),
    noCodeReasonClassName(element),
  ].filter((name): name is string => Boolean(name));
  if (!icon && classNames.length === 0) return NO_ACCENT;
  return { icon, className: classNames.length ? classNames.join(" ") : undefined };
}

const NO_CODE_REASON_MESSAGES: Record<string, string> = {
  conceptual: "This box stands for a concept, not a specific piece of code — there's nothing to open.",
  unresolved: "This box's path could not be matched to any code in the graph — it may have moved, " +
    "been renamed, or the diagram may be out of date.",
};

/** The description-popup body for a `conceptual`/`unresolved` no-code box -- an authored
 * `meta.details`/`description` wins first (same precedent a Planned block's popup already follows). */
export function noCodeReasonMessage(element: CanvasElement, reason: string): string {
  const authored = stringMeta(element, "details") ?? element.description;
  if (authored) return authored;
  const base = NO_CODE_REASON_MESSAGES[reason] ?? "This box has no linked code.";
  const detail = stringMeta(element, "no_code_detail");
  return reason === "unresolved" && detail ? `${base} (authored path: "${detail}")` : base;
}
