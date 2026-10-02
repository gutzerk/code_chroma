import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { PlanStep } from "../state/types";
import { planStatusForSteps } from "./planStatus";
import { useCollisionParticipant } from "./collision/collisionStore";
import { useCollisionAvoidance } from "./collision/useCollisionAvoidance";
import { DropGhost } from "./collision/DropGhost";
import { useResizableSize } from "./useResizableSize";
import { blockCodeViewClasses } from "./usePanelDragResize";

const KIND_LABEL: Record<string, string> = {
  modify: "Modify",
  add: "Add",
  create: "Create",
  delete: "Delete",
};

/** What distinguishes one card layer from another. Note the *inner* card classes are deliberately
 * not in here: both layers render `plan-step`, `plan-step--<kind>` and friends, so there is one CSS
 * block and one card visual language. Only the panel frame, the testids and the wording differ. */
export interface CardLayer {
  /** Class on the panel wrapper, e.g. "plan-panel" — what CSS colours the frame by. */
  panelClass: string;
  /** Root testid; the header, body and resize handle derive `${testId}-header` and so on. */
  testId: string;
  /** Testid on each card. */
  cardTestId: string;
  /** Header title, e.g. "AI Plan". */
  title: string;
  /** [singular, plural] noun for the header count, e.g. ["step", "steps"]. */
  noun: [string, string];
  /** Namespace for the collision participant id, so two layers on one node don't collide as one. */
  participantPrefix: string;
  /** `data-<prefix>-node-id` / `data-<prefix>-status` stamps the connector overlay queries. */
  dataPrefix: string;
  /** Bumped on drag/resize so this layer's connector follows the panel. */
  notifyGeometryChange: () => void;
  /** Shown on a card whose target doesn't exist yet, e.g. "will create here". */
  ancestorHint: string;
  /** An always-visible extra line under the card's label, e.g. "payments.py · charge". */
  meta?: (card: PlanStep) => ReactNode;
}

export interface CardPanelProps {
  cards: PlanStep[];
  layer: CardLayer;
  /** Extra class appended to the wrapper — inline usage (Block/TreeNode/CodePopup) passes
   * block-code-view--inline to reuse the code panel's framed, fly-out-to-the-right styling. */
  className?: string;
  /** Makes the header a drag handle that repositions the panel, same convention as CodeView. */
  draggable?: boolean;
  /** Adds a bottom-right corner handle to stretch the panel, same convention as CodeView. */
  resizable?: boolean;
}

/** The cards for one node, rendered as a framed panel that flies out to the right of its block — the
 * overlay sibling of CodeView, sharing the same drag/resize chrome so it reads as a distinct window
 * (not more of the block). A node can hold several cards, stacked inside; `kind` drives each card's
 * accent, and an ancestor resolution shows the layer's hint (the real target doesn't exist in the
 * graph yet). Cards with `details` are click-to-expand in place (preview line always visible, full
 * text toggles under it) — transient local state, same reset-on-reload philosophy as ExpansionStore
 * (FR-018). */
export function CardPanel({ cards, layer, className, draggable, resizable }: CardPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Both a mover and an obstacle: the panel settles beside a box rather than parking on top of it,
  // and a box dragged towards the panel avoids it in turn. Only while draggable — a panel opened
  // inside CodePopup is positioned in screen pixels and the store filters it out anyway.
  const panelId = `${layer.participantPrefix}::${cards[0]?.node_id ?? ""}`;
  useCollisionParticipant(panelId, panelRef, Boolean(draggable));
  const { offset, isDragging, handleProps, ghost } = useCollisionAvoidance({
    id: panelId,
    targetRef: panelRef,
    enabled: Boolean(draggable),
  });
  const { size, isResizing, handleProps: resizeHandleProps } = useResizableSize(panelRef);
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(() => new Set());

  // Dragging/resizing the panel only mutates its local transform, invisible to the connector
  // overlay's expand/collapse triggers — bump the geometry counter so the line follows the panel.
  useEffect(() => {
    layer.notifyGeometryChange();
  }, [layer, offset, size]);

  const toggleCard = (cardId: string) => {
    setExpandedCardIds((previous) => {
      const next = new Set(previous);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  if (cards.length === 0) return null;

  const classes = blockCodeViewClasses({
    extra: layer.panelClass,
    className,
    dragging: draggable && isDragging,
    resizing: resizable && isResizing,
  });

  return (
    <div
      ref={panelRef}
      className={classes}
      data-testid={layer.testId}
      {...{
        [`data-${layer.dataPrefix}-node-id`]: cards[0].node_id,
        [`data-${layer.dataPrefix}-status`]: planStatusForSteps(cards),
      }}
      style={{
        ...(draggable ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {}),
        ...(resizable && size
          ? { width: size.width, height: size.height, maxWidth: "none", maxHeight: "none" }
          : {}),
      }}
    >
      <div
        className="block-code-view-header"
        data-testid={`${layer.testId}-header`}
        {...(draggable ? handleProps : {})}
      >
        {draggable && (
          <span className="block-code-view-grip" aria-hidden="true">
            ⠿
          </span>
        )}
        <span className="block-code-view-name">{layer.title}</span>
        <span className="block-code-view-params">
          {cards.length} {layer.noun[cards.length === 1 ? 0 : 1]}
        </span>
      </div>
      <div className="plan-panel-body" data-testid={`${layer.testId}-body`}>
        {cards.map((card) => {
          const hasDetails = Boolean(card.details);
          const isExpanded = hasDetails && expandedCardIds.has(card.id);
          return (
            <div
              key={card.id}
              className={[
                "plan-step",
                `plan-step--${card.kind ?? "modify"}`,
                hasDetails ? "plan-step--expandable" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-testid={layer.cardTestId}
              data-kind={card.kind ?? "modify"}
            >
              <div
                className="plan-step-preview"
                data-testid={`${layer.cardTestId}-preview`}
                {...(hasDetails
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-expanded": isExpanded,
                      onClick: (event: MouseEvent) => {
                        event.stopPropagation();
                        toggleCard(card.id);
                      },
                      onKeyDown: (event: KeyboardEvent) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleCard(card.id);
                        }
                      },
                    }
                  : {})}
              >
                {hasDetails && (
                  <span className="plan-step-chevron" aria-hidden="true">
                    {isExpanded ? "▾" : "▸"}
                  </span>
                )}
                <span className="plan-step-kind">{KIND_LABEL[card.kind ?? "modify"]}</span>
                <span className="plan-step-text">{card.text}</span>
                {card.resolution === "ancestor" && (
                  <span className="plan-step-hint">{layer.ancestorHint}</span>
                )}
              </div>
              {layer.meta && (
                <div className="plan-step-meta" data-testid={`${layer.cardTestId}-meta`}>
                  {layer.meta(card)}
                </div>
              )}
              {isExpanded && (
                <div className="plan-step-details" data-testid={`${layer.cardTestId}-details`}>
                  {card.details}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {resizable && (
        <div
          className="block-code-view-resize-handle"
          data-testid={`${layer.testId}-resize-handle`}
          aria-hidden="true"
          {...resizeHandleProps}
        />
      )}
      <DropGhost ghost={ghost} />
    </div>
  );
}
