import type { ChangeCard } from "../state/types";
import { changeCardStore } from "../state/changeCardStore";
import { CardPanel, type CardLayer } from "./CardPanel";

export interface ChangeCardsPanelProps {
  cards: ChangeCard[];
  /** Extra class appended to the wrapper — inline usage passes block-code-view--inline. */
  className?: string;
  draggable?: boolean;
  resizable?: boolean;
}

/** The always-visible second line on a change card: where it is, and how big it is. */
function changeMeta(card: ChangeCard): string {
  const where = card.symbol ? `${card.file} · ${card.symbol}` : card.file;
  if (card.binary) return `${where} · binary`;
  return `${where} · +${card.added_lines} −${card.removed_lines}`;
}

const CHANGE_CARD_LAYER: CardLayer = {
  panelClass: "change-cards-panel",
  testId: "change-cards-panel",
  cardTestId: "change-card",
  title: "Changed here",
  noun: ["change", "changes"],
  // Its own namespace, so a plan panel and a change panel on one node register as two participants
  // and settle beside each other instead of stacking.
  participantPrefix: "change-cards",
  dataPrefix: "change",
  notifyGeometryChange: changeCardStore.notifyGeometryChange,
  ancestorHint: "changed inside here",
  meta: (card) => changeMeta(card as ChangeCard),
};

/** The deterministic change cards for one node: what changed here, and what kind of change it was.
 * Rendering lives in CardPanel, shared with the plan layer. */
export function ChangeCardsPanel({
  cards,
  className,
  draggable,
  resizable,
}: ChangeCardsPanelProps) {
  return (
    <CardPanel
      cards={cards}
      layer={CHANGE_CARD_LAYER}
      className={className}
      draggable={draggable}
      resizable={resizable}
    />
  );
}
