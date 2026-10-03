import type { CanvasElement } from "../../state/types";
import { BLOCK_RULES } from "./elementRules";
import { stringMeta } from "./elementMeta";
import { NO_CODE_REASON_LABELS } from "./nodeAccentLogic";

// Pure helpers (`accentFor`, `noCodeReasonMessage`, the `NodeAccent` type, the shared
// `NO_CODE_REASON_LABELS` map) live in ./nodeAccentLogic.tsx so this file exports only components
// and stays Fast-Refresh compatible.

/**
 * "Band + meta row, ghost no-code" box format (data/Форма для задачи): a top band holds the box's
 * *intent* -- `meta.plan_kind` (055-diagram-feature-plan) and `meta.order` (054-diagram-flow-order,
 * CONTEXT.md's "Order") -- replacing the old floating top-right PlanKindChip pill and top-right
 * OrderBadge corner tag. Renders nothing when neither is present; either half renders alone when
 * only one of the two is authored. Plan no longer drives a border accent at all (see
 * `noCodeReasonClassName` above) -- this band is now its only visible trace.
 */
export function NodeTopBand({ element }: { element: CanvasElement }) {
  const planKind = stringMeta(element, "plan_kind");
  const plan = planKind && planKind in PLAN_KIND_LABELS ? planKind : undefined;
  const order = stringMeta(element, "order");
  if (!plan && !order) return null;
  return (
    <div
      className={`canvas-node-top-band${plan ? ` canvas-node-top-band--plan-${plan}` : ""}`}
      data-testid="canvas-node-top-band"
      style={plan ? { background: PLAN_KIND_COLOR_VARS[plan] } : undefined}
    >
      {plan && (
        <span data-testid="canvas-node-top-band-plan">PLAN &middot; {PLAN_KIND_LABELS[plan]}</span>
      )}
      {order && (
        <span
          className="canvas-node-order-badge"
          data-testid="canvas-node-order-badge"
          title={`Order: ${order}`}
        >
          STEP {order}
        </span>
      )}
    </div>
  );
}

const IMPACT_STATUS_LABELS: Record<string, string> = { new: "ADD", modified: "MODIFY", deleted: "DELETE" };

/** The glyph prefixing the impact chip, mirroring the diff overlay's marks (`+ ~ −`). */
const IMPACT_STATUS_MARK: Record<string, string> = { new: "+", modified: "~", deleted: "−" };

/** Impact's authored `meta.status` (type-impact.md) as an explicit text chip in the box's meta row
 * (`NodeMetaRow` below) -- a prototype comparing color-only vs text-labeled treatments showed the
 * role needs to read as text, not color alone. `"context"` (an unchanged box) intentionally gets no
 * chip. Gated on `BLOCK_RULES[element.render].statusChip === "impact"` so a future type that reuses
 * `meta.status` for something else never picks this chip up by accident. `count` (the box's real
 * attributed change count, from
 * `useNodeOverlays`) is appended as `· N` to mirror the nodemap form's `~ MODIFY · 17`. */
export function ImpactStatusChip({ element, count }: { element: CanvasElement; count?: number }) {
  if (BLOCK_RULES[element.render].statusChip !== "impact") return null;
  const status = stringMeta(element, "status");
  if (!status || !(status in IMPACT_STATUS_LABELS)) return null;
  const countText = count && count > 0 ? ` · ${count}` : "";
  return (
    <span className={`node-meta-chip node-meta-chip--impact-${status}`} data-testid="impact-status-chip">
      {IMPACT_STATUS_MARK[status] ?? ""} {IMPACT_STATUS_LABELS[status]}{countText}
    </span>
  );
}

const PLAN_KIND_LABELS: Record<string, string> = {
  add: "ADD",
  create: "CREATE",
  modify: "MODIFY",
  delete: "DELETE",
};

/** Same add/create/modify/delete palette the old dashed-border accent used, now reused by
 * `NodeTopBand`'s plan segment instead of the border -- plan_kind no longer touches the box's own
 * frame at all (see the "Band + meta row, ghost no-code" format below). Values follow the
 * `data/Форма для задачи` palette, mapped onto dedicated kind tokens so the box accents never
 * inherit the app's generic accent/warning hues (which the same diagram can use for the diff
 * overlay and other chrome -- see nodeAccent.css). */
const PLAN_KIND_COLOR_VARS: Record<string, string> = {
  add: "var(--kind-add)",
  create: "var(--kind-create)",
  modify: "var(--kind-modify)",
  delete: "var(--kind-delete)",
};

/** `meta.no_code_reason` as its own outlined/tinted meta-row chip -- distinct from
 * `ImpactStatusChip`'s filled pill, so a no-code box's reason reads as "different kind of fact", not
 * just another status. Unlike the retired left-edge strip this replaced, it renders alongside an
 * impact status chip rather than being suppressed by one -- the meta row has room for both. */
export function NoCodeChip({ element }: { element: CanvasElement }) {
  const reason = stringMeta(element, "no_code_reason");
  if (!reason || !(reason in NO_CODE_REASON_LABELS)) return null;
  return (
    <span className={`node-meta-chip node-meta-chip--no-code-${reason}`} data-testid="no-code-chip">
      &empty; {NO_CODE_REASON_LABELS[reason]}
    </span>
  );
}

/** The box's inline meta row -- impact status then no-code reason, both plain in-flow chips below
 * the title instead of the old floating top-right pill / left-edge strip. Renders nothing when the
 * box carries neither. `change` passes the box's real attributed change count (from `useNodeOverlays`,
 * same source as `NodeChangeBadge`) so the impact chip can echo it as `· N`. */
export function NodeMetaRow({ element, count }: { element: CanvasElement; count?: number }) {
  const status = stringMeta(element, "status");
  const hasStatus =
    BLOCK_RULES[element.render].statusChip === "impact" &&
    Boolean(status && status in IMPACT_STATUS_LABELS);
  const reason = stringMeta(element, "no_code_reason");
  const hasNoCode = Boolean(reason && reason in NO_CODE_REASON_LABELS);
  const isEpic = element.render === "epic";
  if (isEpic) return <EpicMetaRow element={element} />;
  if (!hasStatus && !hasNoCode) return null;
  return (
    <div className="canvas-node-meta-row" data-testid="canvas-node-meta-row">
      <ImpactStatusChip element={element} count={count} />
      <NoCodeChip element={element} />
    </div>
  );
}

/** The epic brief's tagged meta row -- status / priority / group / depends_on read from the epic's
 * authored `meta` (mirrors the epics-brief reference diagram's badge line), shown only for epic
 * brief boxes (`render: "epic"`). Docs: docs/architecture/epics-view.md. */
function EpicMetaRow({ element }: { element: CanvasElement }) {
  const chips: Array<{ value: string; className: string }> = [];
  const status = stringMeta(element, "status");
  if (status) chips.push({ value: status, className: "node-meta-chip--epic-status" });
  const priority = stringMeta(element, "priority");
  if (priority) chips.push({ value: priority, className: "node-meta-chip--epic-priority" });
  const group = stringMeta(element, "group");
  if (group) chips.push({ value: group, className: "node-meta-chip--epic-group" });
  const dependsOn = stringMeta(element, "depends_on");
  if (dependsOn) chips.push({ value: `depends_on → ${dependsOn}`, className: "node-meta-chip--epic-depends-on" });
  if (chips.length === 0) return null;
  return (
    <div className="canvas-node-meta-row" data-testid="canvas-node-meta-row">
      {chips.map((chip) => (
        <span key={chip.value} className={`node-meta-chip ${chip.className}`}>
          {chip.value}
        </span>
      ))}
    </div>
  );
}
