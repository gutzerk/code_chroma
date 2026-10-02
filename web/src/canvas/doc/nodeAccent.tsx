import type { ReactNode } from "react";
import type { C1BlockKind, CanvasElement } from "../../state/types";
import { BrandIcon } from "../../icons/BrandIcon";
import { BRAND_ICONS } from "../../icons/brands.generated";
import { C1BlockIcon } from "../../icons/C1BlockIcon";
import { groupColorIndex } from "./groupColor";
import { stringMeta } from "./elementMeta";

export interface NodeAccent {
  icon?: ReactNode;
  className?: string;
}

const NO_ACCENT: NodeAccent = {};

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
  if (icon && icon in BRAND_ICONS) return <BrandIcon slug={icon} />;
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
 * class (see nodeStyles.tsx), so this generalizes with no new CSS needed. */
function statusClassName(element: CanvasElement): string | undefined {
  const status = stringMeta(element, "status");
  if (!status) return undefined;
  return `block-change--${STATUS_CLASS_ALIASES[status] ?? status}`;
}

function groupClassName(element: CanvasElement): string | undefined {
  const group = stringMeta(element, "group");
  return group ? `custom-node-group-${groupColorIndex(group)}` : undefined;
}

const PLAN_KIND_LABELS: Record<string, string> = {
  add: "ADD",
  create: "CREATE",
  modify: "MODIFY",
  delete: "DELETE",
};

/** Drives the dashed-border accent in styles.css (055-diagram-feature-plan's Planned block). */
function planKindClassName(element: CanvasElement): string | undefined {
  const planKind = stringMeta(element, "plan_kind");
  return planKind && planKind in PLAN_KIND_LABELS ? `plan-kind-${planKind}` : undefined;
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
    planKindClassName(element),
  ].filter((name): name is string => Boolean(name));
  if (!icon && classNames.length === 0) return NO_ACCENT;
  return { icon, className: classNames.length ? classNames.join(" ") : undefined };
}

/** The authored step number (`meta.order`, CONTEXT.md's "Order") rendered as a small badge on the
 * box itself, not the arrow -- 054-diagram-flow-order. Unlike `accentFor`'s rules, this carries a
 * value the reader needs to see, not just a style switch, so it's its own small component rather
 * than another `className` rule. Renders nothing when `order` is absent. */
export function OrderBadge({ element }: { element: CanvasElement }) {
  const order = stringMeta(element, "order");
  if (!order) return null;
  return (
    <span className="canvas-node-order-badge" data-testid="canvas-node-order-badge" title={`Order: ${order}`}>
      {order}
    </span>
  );
}

/** The shared floating top-right pill both `PlanKindChip` and `ImpactStatusChip` render -- same
 * position/shape/testid-by-prop contract, just a different meta field, label map and class prefix.
 * Renders nothing when `value` is absent or not a key of `labels`, same "no accent-bearing meta,
 * no output" rule the rest of this module's per-field functions follow. */
function LabeledChip({
  value, labels, classPrefix, testId,
}: {
  value: string | undefined;
  labels: Record<string, string>;
  classPrefix: string;
  testId: string;
}) {
  if (!value || !(value in labels)) return null;
  return (
    <span className={`status-chip ${classPrefix}--${value}`} data-testid={testId}>
      {labels[value]}
    </span>
  );
}

/** The Feature-plan role (`meta.plan_kind`, 055-diagram-feature-plan) as an explicit text chip -- a
 * prototype comparing color-only vs text-labeled treatments showed the role needs to read as text,
 * not color alone. Renders nothing when `plan_kind` is absent or unrecognized. */
export function PlanKindChip({ element }: { element: CanvasElement }) {
  return (
    <LabeledChip
      value={stringMeta(element, "plan_kind")}
      labels={PLAN_KIND_LABELS}
      classPrefix="plan-kind-chip"
      testId="plan-kind-chip"
    />
  );
}

const IMPACT_STATUS_LABELS: Record<string, string> = { new: "ADD", modified: "MODIFY", deleted: "DELETE" };

/** Impact's authored `meta.status` (type-impact.md) as an explicit text chip, mirroring
 * `PlanKindChip`'s verdict that the role needs to read as text, not the left-edge accent's color
 * alone. `"context"` (an unchanged box) intentionally gets no chip, same as an unrecognized plan_kind
 * gets no PlanKindChip. Gated on `render === "impact"` so a future type that reuses `meta.status` for
 * something else never picks this chip up by accident. */
export function ImpactStatusChip({ element }: { element: CanvasElement }) {
  if (element.render !== "impact") return null;
  return (
    <LabeledChip
      value={stringMeta(element, "status")}
      labels={IMPACT_STATUS_LABELS}
      classPrefix="impact-status-chip"
      testId="impact-status-chip"
    />
  );
}
