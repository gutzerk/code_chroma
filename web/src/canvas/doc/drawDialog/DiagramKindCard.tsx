import type { KeyboardEvent } from "react";
import { schematicFor } from "./schematics";
import type { DrawCard } from "./useDiagramKinds";

/** One selectable diagram type: its schematic, name and one-line purpose; a radio in the dialog's group. */
export function DiagramKindCard({
  card,
  selected,
  onPick,
  onKeyDown,
}: {
  card: DrawCard;
  selected: boolean;
  onPick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      className={`draw-card${selected ? " draw-card--on" : ""}`}
      data-testid={`draw-card-${card.id}`}
      data-card-id={card.id}
      onClick={onPick}
      onKeyDown={onKeyDown}
    >
      <span className="draw-card-art">{schematicFor(card.schematic)}</span>
      <span className="draw-card-name">{card.name}</span>
      <span className="draw-card-purpose">{card.purpose}</span>
    </button>
  );
}
