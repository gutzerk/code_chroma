import { useSyncExternalStore } from "react";
import { ROOT_NODE_ID, type BlockView, type HierarchyNodeRef } from "./types";
import { arraysEqual, Store } from "./createStore";

const DEFAULT_BLOCK_VIEW: BlockView = {
  node_id: "",
  expand_state: "collapsed",
  code_visible: false,
};

/**
 * Global expansion/orientation store. useSyncExternalStore-backed, in-memory only — never
 * persisted, never reflected in the URL (FR-018). Also holds a lightweight parent-link + name
 * cache (populated as blocks fetch their children) so the breadcrumb's deepest-expanded-path can
 * be derived without re-fetching.
 */
class ExpansionStore extends Store {
  private blockViews = new Map<string, BlockView>();
  private expandedOrder: string[] = [];
  private codeVisibleOrder: string[] = [];
  private parentLinks = new Map<string, string | null>();
  private names = new Map<string, string>();

  // useSyncExternalStore requires getSnapshot to return a stable (===) reference between
  // notifications — these cache the derived array snapshots, refreshed once per notify() rather
  // than recomputed (as a new array) on every render, which would otherwise loop forever.
  private expandedOrderSnapshot: string[] = [];
  private codeVisibleOrderSnapshot: string[] = [];
  private deepestExpandedPathSnapshot: string[] = [];

  // Every mutation (expand/collapse/showCode/hideCode/a real reparent via cacheNodeRefs) calls
  // notify(), but most of them only touch ONE of these three derived views — e.g. showCode() never
  // changes expandedOrder. Keeping each snapshot's reference stable unless its own content actually
  // changed lets useSyncExternalStore correctly bail out subscribers (like ConnectionsOverlay,
  // which refetches the whole visible tree's connections whenever expandedNodeIds changes
  // reference) instead of re-running on every unrelated mutation.
  private notify(): void {
    const nextExpandedOrder = [...this.expandedOrder];
    if (!arraysEqual(nextExpandedOrder, this.expandedOrderSnapshot)) {
      this.expandedOrderSnapshot = nextExpandedOrder;
    }
    // The deepest path also depends on parentLinks (mutated independently by cacheNodeRefs on a
    // live reparent), not just expandedOrder, so it's recomputed on every notify() rather than
    // gated behind the expandedOrder-changed check above — cheap (a single ancestor-chain walk).
    const nextDeepestPath = this.computeDeepestExpandedPath();
    if (!arraysEqual(nextDeepestPath, this.deepestExpandedPathSnapshot)) {
      this.deepestExpandedPathSnapshot = nextDeepestPath;
    }
    const nextCodeVisibleOrder = [...this.codeVisibleOrder];
    if (!arraysEqual(nextCodeVisibleOrder, this.codeVisibleOrderSnapshot)) {
      this.codeVisibleOrderSnapshot = nextCodeVisibleOrder;
    }
    this.emit();
  }

  getBlockView = (nodeId: string): BlockView => {
    return this.blockViews.get(nodeId) ?? DEFAULT_BLOCK_VIEW;
  };

  private setBlockView(nodeId: string, patch: Partial<BlockView>): void {
    const current = this.getBlockView(nodeId);
    this.blockViews.set(nodeId, { ...current, node_id: nodeId, ...patch });
  }

  private removeFromExpandedOrder(nodeId: string): void {
    const index = this.expandedOrder.indexOf(nodeId);
    if (index !== -1) this.expandedOrder.splice(index, 1);
  }

  private removeFromCodeVisibleOrder(nodeId: string): void {
    const index = this.codeVisibleOrder.indexOf(nodeId);
    if (index !== -1) this.codeVisibleOrder.splice(index, 1);
  }

  private collapseInternal(nodeId: string): void {
    this.removeFromExpandedOrder(nodeId);
    this.removeFromCodeVisibleOrder(nodeId);
    // A hidden inline code view shouldn't silently resurrect the next time this block (or an
    // ancestor of it) re-expands, so clear it alongside expand_state.
    this.setBlockView(nodeId, { expand_state: "collapsed", code_visible: false });
    // A collapsed block's children unmount and are no longer visible, so any of its descendants
    // still tracked as expanded must collapse too — otherwise the breadcrumb (derived from the
    // most-recently-expanded entry) could point at a node that's no longer on screen.
    for (const otherId of [...this.expandedOrder]) {
      if (this.isDescendantOf(otherId, nodeId)) this.collapseInternal(otherId);
    }
  }

  private isDescendantOf(nodeId: string, ancestorId: string): boolean {
    let current = this.parentLinks.get(nodeId);
    while (current) {
      if (current === ancestorId) return true;
      current = this.parentLinks.get(current);
    }
    return false;
  }

  /** Expands a container block (folder/file/class). No-op if already expanded. */
  expand = (nodeId: string): void => {
    if (this.getBlockView(nodeId).expand_state === "expanded") return;
    if (!this.expandedOrder.includes(nodeId)) this.expandedOrder.push(nodeId);
    this.setBlockView(nodeId, { expand_state: "expanded" });
    this.notify();
  };

  /** Collapses a block — clears its expand state and evicts it from the expanded order. */
  collapse = (nodeId: string): void => {
    this.collapseInternal(nodeId);
    this.notify();
  };

  toggleExpand = (nodeId: string): void => {
    if (this.getBlockView(nodeId).expand_state === "expanded") {
      this.collapse(nodeId);
    } else {
      this.expand(nodeId);
    }
  };

  /** Shows a node's inline code view (only meaningful in "inline" code-view mode). */
  showCode = (nodeId: string): void => {
    if (!this.codeVisibleOrder.includes(nodeId)) this.codeVisibleOrder.push(nodeId);
    this.setBlockView(nodeId, { code_visible: true });
    this.notify();
  };

  /** Hides a node's inline code view, restoring whatever expand_state it already had. */
  hideCode = (nodeId: string): void => {
    this.removeFromCodeVisibleOrder(nodeId);
    this.setBlockView(nodeId, { code_visible: false });
    this.notify();
  };

  toggleCode = (nodeId: string): void => {
    if (this.getBlockView(nodeId).code_visible) {
      this.hideCode(nodeId);
    } else {
      this.showCode(nodeId);
    }
  };

  getExpandedNodeIdsByOrder = (): string[] => this.expandedOrderSnapshot;

  getCodeVisibleNodeIdsByOrder = (): string[] => this.codeVisibleOrderSnapshot;

  isVisible = (nodeId: string): boolean => this.getBlockView(nodeId).expand_state === "expanded";

  /** Records a node's parent + display name as its containing block fetches children, so the
   * breadcrumb can walk the tree without a fetch. Notifies only on a genuine reparent/rename of an
   * already-cached node (e.g. a live reanalyze) — not on ordinary first-time population, which
   * would otherwise notify on every children fetch. */
  cacheNodeRefs = (refs: HierarchyNodeRef[]): void => {
    let changed = false;
    for (const ref of refs) {
      if (
        (this.parentLinks.has(ref.node_id) && this.parentLinks.get(ref.node_id) !== ref.parent_id) ||
        (this.names.has(ref.node_id) && this.names.get(ref.node_id) !== ref.name)
      ) {
        changed = true;
      }
      this.parentLinks.set(ref.node_id, ref.parent_id);
      this.names.set(ref.node_id, ref.name);
    }
    if (changed) this.notify();
  };

  getName = (nodeId: string): string => this.names.get(nodeId) ?? nodeId;

  /** The one upward parentLinks walk this class does, root-first and including nodeId itself.
   * `complete` says the chain provably reached a root (an ancestor whose parent is recorded as
   * null) rather than merely running out of cached links — `has` rather than `get`, since an absent
   * id and a cached root both read as falsy and only the latter may end the walk. Callers that just
   * want a best-effort path ignore the flag; getCachedAncestorPath is the one that can't. */
  private ancestorPath(nodeId: string): { path: string[]; complete: boolean } {
    const path: string[] = [];
    let current = nodeId;
    while (this.parentLinks.has(current)) {
      path.unshift(current);
      const parent = this.parentLinks.get(current) ?? null;
      if (parent === null) return { path, complete: true };
      current = parent;
    }
    path.unshift(current);
    return { path, complete: false };
  }

  /** Root-first id path from nodeId up, or null when parentLinks can't prove the chain complete —
   * what lets a diff reveal skip its per-ancestor getNode walk for an already-cached node. */
  getCachedAncestorPath = (nodeId: string): string[] | null => {
    const { path, complete } = this.ancestorPath(nodeId);
    if (complete) return path;
    // ROOT_NODE_ID is synthesized by the bridge rather than fetched, so it's never cached itself.
    return path[0] === ROOT_NODE_ID ? path : null;
  };

  /** Walks the root→node path, returning the deepest ancestor (or nodeId itself) whose box is
   * actually rendered — used to bundle a connection to whichever visible box currently contains it. */
  getNearestVisibleAncestor = (nodeId: string): string | null => {
    const { path } = this.ancestorPath(nodeId);
    if (path.length === 0) return null;
    let visible = path[0]; // root is always rendered
    for (let i = 1; i < path.length; i++) {
      if (this.isVisible(path[i - 1])) visible = path[i];
      else break;
    }
    return visible;
  };

  private computeDeepestExpandedPath(): string[] {
    const deepest = this.expandedOrder[this.expandedOrder.length - 1];
    if (!deepest) return [];
    return this.ancestorPath(deepest).path;
  }

  /** Root-first path of node ids from the deepest currently-expanded entry up to its root. */
  getDeepestExpandedPath = (): string[] => this.deepestExpandedPathSnapshot;

  /** Full reset — tests and workspace switches (resetWorkspaceStores). */
  reset = (): void => {
    this.blockViews.clear();
    this.expandedOrder = [];
    this.codeVisibleOrder = [];
    this.parentLinks.clear();
    this.names.clear();
    this.notify();
  };
}

export const expansionStore = new ExpansionStore();

export function useBlockView(nodeId: string): BlockView {
  return useSyncExternalStore(expansionStore.subscribe, () => expansionStore.getBlockView(nodeId));
}

export function useDeepestExpandedPath(): string[] {
  return useSyncExternalStore(expansionStore.subscribe, expansionStore.getDeepestExpandedPath);
}

export function useExpandedNodeIdsByOrder(): string[] {
  return useSyncExternalStore(expansionStore.subscribe, expansionStore.getExpandedNodeIdsByOrder);
}

export function useCodeVisibleNodeIdsByOrder(): string[] {
  return useSyncExternalStore(
    expansionStore.subscribe,
    expansionStore.getCodeVisibleNodeIdsByOrder,
  );
}
