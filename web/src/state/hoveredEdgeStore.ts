import { useSyncExternalStore } from "react";
import { Store } from "./createStore";

/** The arrow the pointer is currently on, plus the blocks it lands on. */
export interface HoveredEdge {
  /** The edge's own render key — which arrow to draw as active. */
  key: string;
  /** Canvas node id of the block the arrow leaves, or null when it isn't resolved to one. */
  fromNodeId: string | null;
  /** Canvas node id of the block the arrow enters, or null when it isn't resolved to one. */
  toNodeId: string | null;
}

/**
 * Which relationship arrow the pointer is on, shared by both C1 arrow renderers (C1View's dagre
 * layer and C1InternalConnections' DOM-measured overlay) and by every block via `useNodeChrome`.
 * One store rather than local state per overlay because the two layers draw one diagram: hovering a
 * box-to-box arrow has to dim the internal call chain too, and both endpoints of an arrow have to
 * light up wherever they happen to be rendered. In-memory only, resets on reload — the same FR-018
 * precedent as ExpansionStore.
 */
class HoveredEdgeStore extends Store {
  private hovered: HoveredEdge | null = null;
  private focusedNode: string | null = null;
  private pinnedNodes: ReadonlySet<string> = new Set();

  getHovered = (): HoveredEdge | null => this.hovered;

  /** True when anything is focused — an arrow directly, a block standing in for all of its own
   * arrows, or a pinned selection. Either way every other arrow dims. */
  isHovering = (): boolean =>
    this.hovered !== null || this.focusedNode !== null || this.pinnedNodes.size > 0;

  /** True for the arrow(s) the focus applies to: the one hovered arrow, or every arrow landing on a
   * focused or pinned block. Hovering a block is how you answer "which lines are this box's?"
   * without having to find and hover each thread-thin line first. */
  isActive = (key: string, fromNodeId?: string | null, toNodeId?: string | null): boolean => {
    if (this.hovered?.key === key) return true;
    if (fromNodeId != null && this.isFocusedNode(fromNodeId)) return true;
    return toNodeId != null && this.isFocusedNode(toNodeId);
  };

  private isFocusedNode(nodeId: string): boolean {
    return this.focusedNode === nodeId || this.pinnedNodes.has(nodeId);
  }

  isEndpoint = (nodeId: string): boolean =>
    this.isFocusedNode(nodeId) ||
    (this.hovered !== null &&
      (this.hovered.fromNodeId === nodeId || this.hovered.toNodeId === nodeId));

  /**
   * Pins a set of blocks so their arrows stay highlighted after the pointer moves away — the
   * persistent counterpart to `setFocusedNode`. The caller owns the id space: it must pass ids in
   * whatever namespace that view's `RelationshipEdge` endpoints use, which is why this is pushed in
   * rather than read off `selectionStore` here (a C1 box id and a C1 arrow endpoint id are not the
   * same thing, while a Patterns node id is).
   */
  setPinnedNodes = (nodeIds: readonly string[]): void => {
    if (
      nodeIds.length === this.pinnedNodes.size &&
      nodeIds.every((id) => this.pinnedNodes.has(id))
    ) {
      return;
    }
    this.pinnedNodes = new Set(nodeIds);
    this.emit();
  };

  setHovered = (edge: HoveredEdge): void => {
    if (this.hovered?.key === edge.key) return;
    this.hovered = edge;
    this.emit();
  };

  /** Focus every arrow touching one block. Set on block hover; `clearNode` reverses it. */
  setFocusedNode = (nodeId: string): void => {
    if (this.focusedNode === nodeId) return;
    this.focusedNode = nodeId;
    this.emit();
  };

  /** Guarded like `clear` below, and for the same reason: pointer-leave of the block being left can
   * arrive after pointer-enter of the one being entered. */
  clearNode = (nodeId: string): void => {
    if (this.focusedNode !== nodeId) return;
    this.focusedNode = null;
    this.emit();
  };

  /**
   * Drops the hover, but only if `key` is still the hovered arrow. Arrows overlap constantly (lanes
   * put two of them 14px apart), so the pointerleave of the one being left routinely arrives *after*
   * the pointerenter of the one being entered — an unguarded clear would wipe the new highlight and
   * leave the diagram dimmed with nothing active.
   */
  clear = (key: string): void => {
    if (this.hovered?.key !== key) return;
    this.hovered = null;
    this.emit();
  };

  /** Full reset — tests and workspace switches (resetWorkspaceStores). */
  reset = (): void => {
    this.hovered = null;
    this.focusedNode = null;
    this.pinnedNodes = new Set();
    this.emit();
  };
}

export const hoveredEdgeStore = new HoveredEdgeStore();

/** True while any arrow is hovered — used to dim everything that isn't the active one. */
export function useIsEdgeHovering(): boolean {
  return useSyncExternalStore(hoveredEdgeStore.subscribe, hoveredEdgeStore.isHovering);
}

/** True for the one hovered arrow, or for any arrow landing on the hovered block. */
export function useIsActiveEdge(
  key: string,
  fromNodeId?: string | null,
  toNodeId?: string | null,
): boolean {
  return useSyncExternalStore(hoveredEdgeStore.subscribe, () =>
    hoveredEdgeStore.isActive(key, fromNodeId, toNodeId),
  );
}

/** True for a block the hovered arrow leaves or enters, so it can accent alongside the arrow. */
export function useIsHoveredEdgeEndpoint(nodeId: string): boolean {
  return useSyncExternalStore(hoveredEdgeStore.subscribe, () =>
    hoveredEdgeStore.isEndpoint(nodeId),
  );
}
