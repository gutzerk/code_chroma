import { useSyncExternalStore } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import { Store } from "../state/createStore";

/** One level of the inspector's drill path. The id is the authority (so a live re-fetch always reads
 * fresh data); the name is carried alongside purely so the header has a title before that fetch
 * resolves. A level may also be a *group* of several node ids — a Patterns merged box opens all its
 * real nodes at once, rendered as one tab per node (see PatternNodeBox's openMany path). */
export interface InspectorEntry {
  id: string;
  name: string;
  group?: { ids: string[] };
  /** The specific canvas box (its own doc element id, not the shared `node_id`) this entry was
   * opened from, when known -- a custom/activity diagram can draw one code entity (one `node_id`) as
   * several boxes at different process steps (054-diagram-flow-order), so matching highlight-target
   * purely on `id` lit up every box sharing that node_id instead of just the one clicked. Absent for
   * entries opened without a specific box in mind (a citation, a change-review row), where falling
   * back to the old node_id match is still the right call -- there is no "the one box" to prefer. */
  sourceId?: string;
}

const EMPTY_STACK: InspectorEntry[] = [];

/**
 * Global state for the C1 inspector panel: the drill stack the panel renders and the client it
 * fetches through. In-memory only, resets on reload — same FR-018 precedent as ExpansionStore.
 *
 * The client lives here rather than being read from context because of where the two things sit:
 * a C1 view's client would be built under the canvas camera, while the panel is a flex sibling in
 * `.app-body`. Binding it through the store is the smallest seam between them.
 */
class InspectorStore extends Store {
  private stackState: InspectorEntry[] = EMPTY_STACK;
  private clientState: EngineClient | null = null;

  getStack = (): InspectorEntry[] => this.stackState;

  getClient = (): EngineClient | null => this.clientState;

  getIsOpen = (): boolean => this.stackState.length > 0;

  /** The entry currently on top of the drill stack — the one the panel actually renders — or null
   * when the panel is closed. Same array reference between calls unless the stack itself changed, so
   * this is a safe useSyncExternalStore snapshot. */
  getTopEntry = (): InspectorEntry | null => this.stackState[this.stackState.length - 1] ?? null;

  /** Publishes the C1 view's client so the panel can resolve `c1-more::` ids as well as real ones. */
  bindClient = (client: EngineClient | null): void => {
    if (this.clientState === client) return;
    this.clientState = client;
    this.emit();
  };

  /** Opens the panel on one node, discarding any previous drill path. `sourceId` is the specific
   * canvas box that was clicked, when the caller has one -- see `InspectorEntry.sourceId`. */
  open = (id: string, name: string, sourceId?: string): void => {
    this.stackState = [{ id, name, sourceId }];
    this.emit();
  };

  /** Opens the panel on several nodes at once (a Patterns merged box), discarding any previous drill
   * path. The group renders as one inspector level with a tab per node; `name` titles the header. */
  openMany = (ids: string[], name: string): void => {
    this.stackState = [{ id: `group::${ids[0] ?? "empty"}`, name, group: { ids } }];
    this.emit();
  };

  /** Drills one level deeper. Re-clicking the row already on top is a no-op, not a duplicate level. */
  push = (id: string, name: string): void => {
    if (this.stackState[this.stackState.length - 1]?.id === id) return;
    this.stackState = [...this.stackState, { id, name }];
    this.emit();
  };

  /** Returns one level. Backing out of the root closes the panel — there is nothing above it. */
  back = (): void => {
    if (this.stackState.length === 0) return;
    this.stackState = this.stackState.slice(0, -1);
    this.emit();
  };

  close = (): void => {
    if (this.stackState.length === 0) return;
    this.stackState = EMPTY_STACK;
    this.emit();
  };

  /** Full reset, including the bound client — called when the C1 view unmounts. */
  reset = (): void => {
    this.stackState = EMPTY_STACK;
    this.clientState = null;
    this.emit();
  };
}

export const inspectorStore = new InspectorStore();

export function useInspectorStack(): InspectorEntry[] {
  return useSyncExternalStore(inspectorStore.subscribe, inspectorStore.getStack);
}

export function useInspectorClient(): EngineClient | null {
  return useSyncExternalStore(inspectorStore.subscribe, inspectorStore.getClient);
}

export function useIsInspectorOpen(): boolean {
  return useSyncExternalStore(inspectorStore.subscribe, inspectorStore.getIsOpen);
}

/** True while `nodeId` is the block currently shown in the inspector panel — including as one of a
 * merged group's tabs — so the canvas can highlight it. When the caller also passes its own box id
 * (`sourceId`, e.g. a `CanvasElement.id`) and the open entry recorded one too, matching narrows to
 * that exact box instead of every box sharing the same `nodeId` — see `InspectorEntry.sourceId`. */
export function useIsInspectorTarget(nodeId: string, sourceId?: string): boolean {
  const entry = useSyncExternalStore(inspectorStore.subscribe, inspectorStore.getTopEntry);
  if (!entry) return false;
  if (entry.group) return entry.group.ids.includes(nodeId);
  if (entry.sourceId !== undefined && sourceId !== undefined) return entry.sourceId === sourceId;
  return entry.id === nodeId;
}
