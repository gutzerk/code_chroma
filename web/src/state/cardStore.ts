import { GeometryStore } from "./versionStore";

/** One overlay layer of cards pinned onto blocks, keyed per node_id. In-memory only, same FR-018
 * precedent as diffOverlayStore — a card's visibility is orthogonal to a block's expand/collapse
 * state, so it can't live on BlockView. Unlike diffs, several cards can target one node, so each
 * entry is a `T[]`. `isActive` is tracked separately from map size so a toggle stays on even when a
 * layer legitimately resolves to zero cards.
 *
 * Generic because the plan layer and the change-card layer are the same store twice over, and one of
 * them silently diverging (a missing stable-EMPTY, a forgotten geometry channel) is exactly the class
 * of bug that made two near-duplicate xterm call sites drift. Each instance owns its own `EMPTY`. */
export class CardStore<T extends { node_id: string }> extends GeometryStore {
  private cardsByNode = new Map<string, T[]>();
  private allSnapshot: T[] = [];
  private isActiveState = false;
  private readonly empty: T[] = [];

  /** Cards targeting one node — returns this instance's stable empty array when none, so
   * useSyncExternalStore doesn't loop on a fresh `[]` each read. */
  getSteps = (nodeId: string): T[] => this.cardsByNode.get(nodeId) ?? this.empty;

  getIsActive = (): boolean => this.isActiveState;

  /** Every card in insertion order — cached as a stable array (same reason as
   * diffOverlayStore.getDeletedDiffs) for the overlay/list consumers. */
  getAllSteps = (): T[] => this.allSnapshot;

  setSteps = (cards: T[]): void => {
    const byNode = new Map<string, T[]>();
    for (const card of cards) {
      const existing = byNode.get(card.node_id);
      if (existing) existing.push(card);
      else byNode.set(card.node_id, [card]);
    }
    this.cardsByNode = byNode;
    this.allSnapshot = cards;
    this.isActiveState = true;
    this.emit();
  };

  /** Clears the layer without touching expansion/code state — the windows a run revealed stay open,
   * they just lose their badges. */
  clear = (): void => {
    this.cardsByNode = new Map();
    this.allSnapshot = [];
    this.isActiveState = false;
    this.emit();
  };

  /** Full reset — tests and workspace switches (resetWorkspaceStores). */
  reset = (): void => {
    this.clear();
  };
}
