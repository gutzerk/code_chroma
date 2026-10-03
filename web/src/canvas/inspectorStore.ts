import { useSyncExternalStore } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import type { CanvasElement } from "../state/types";
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
  /** Set for an epic/story work-item box (010-epics-tree-render Part 5): the entry resolves the
   * `WorkItem` with this id (via an EpicsDiagramClient) and renders its full text (summary, criteria,
   * description, links) instead of a hierarchy node -- an epic box has no real `node_id`. The AI-brief
   * button lives inside that level. */
  workItemId?: string;
  /** Set for any other epics-layer box (a task, phase header or content card that isn't itself a
   * resolvable work item): the panel renders the block's full text + its place in the epic straight
   * from the canvas element, instead of a code node. Carries the whole layer doc so neighbours
   * (a phase's tasks, a task's parent) can be shown. */
  epicBlock?: { element: CanvasElement; doc: { elements: Record<string, CanvasElement> } };
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

  /** Publishes the C1 view's client so the panel can resolve `c1-more::` ids as well as real ones. */
  bindClient = (client: EngineClient | null): void => {
    if (this.clientState === client) return;
    this.clientState = client;
    this.emit();
  };

  /** Opens the panel on one node, discarding any previous drill path. `sourceId` is the specific
   * canvas box that was clicked, when the caller has one -- see `InspectorEntry.sourceId`. Pass
   * `workItemId` for an epic/story box to render its full WorkItem text rather than a code node,
   * or `epicBlock` for any other epics-layer box to render that block's details. */
  open = (
    id: string,
    name: string,
    sourceId?: string,
    workItemId?: string,
    epicBlock?: { element: CanvasElement; doc: { elements: Record<string, CanvasElement> } },
  ): void => {
    this.stackState = [{ id, name, sourceId, workItemId, epicBlock }];
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

/** True while `nodeId` is a block on the inspector's current drill path — the whole stack, not just
 * the node currently rendered at the top — so the canvas keeps the originally-opened block
 * highlighted while the user drills into its files/functions and views code. It only clears when the
 * user opens a *different* block (which resets the stack) or closes the panel (empty stack). Includes
 * merged-group tabs. When the caller also passes its own box id (`sourceId`, e.g. a
 * `CanvasElement.id`) and an open entry recorded one too, matching narrows to that exact box instead
 * of every box sharing the same `nodeId` — see `InspectorEntry.sourceId`. */
function entryMatches(entry: InspectorEntry, nodeId: string, sourceId?: string): boolean {
  if (entry.group) return entry.group.ids.includes(nodeId);
  if (entry.sourceId !== undefined && sourceId !== undefined) return entry.sourceId === sourceId;
  return entry.id === nodeId;
}

export function useIsInspectorTarget(nodeId: string, sourceId?: string): boolean {
  const stack = useSyncExternalStore(inspectorStore.subscribe, inspectorStore.getStack);
  // The stack reference is stable between emits, so this snapshot is safe for useSyncExternalStore.
  return stack.some((entry) => entryMatches(entry, nodeId, sourceId));
}
