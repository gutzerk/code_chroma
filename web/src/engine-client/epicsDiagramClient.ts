import type { EpicItemLink, EpicWorkItem, HierarchyNodeRef, WorkItemSummary } from "../state/types";
import type { EngineClient } from "./EngineClient";
import { DelegatingEngineClient } from "./delegatingEngineClient";

export interface EpicStubRef {
  id: string;
  title: string;
  relation: string;
}

const LEVEL_BY_KIND: Partial<Record<string, HierarchyNodeRef["level"]>> = {
  epic: "folder",
  story: "file",
};

function levelFor(kind: string): HierarchyNodeRef["level"] {
  return LEVEL_BY_KIND[kind] ?? "function";
}

/**
 * Decorator + Virtual Proxy over the real EngineClient for the Epics view (contracts/canvas-node-ids.md).
 * Every id in this view starts with "epic"; `getChildren` refuses to delegate for any unrecognised
 * `epic-`-prefixed id rather than forwarding it to `inner` (FR-035, D-07). A work item is fetched at
 * most once per id: an in-flight fetch is deduplicated by promise, a resolved one is cached until
 * `clearCache()` (the bridge's "changed" ping).
 */
export class EpicsDiagramClient extends DelegatingEngineClient {
  private readonly indexById = new Map<string, WorkItemSummary>();
  private readonly items = new Map<string, EpicWorkItem>();
  private readonly pending = new Map<string, Promise<EpicWorkItem | null>>();
  private readonly stubs = new Map<string, EpicStubRef>();

  constructor(inner: EngineClient) {
    super(inner);
  }

  /** Registers the index's summaries -- every one of these already has a box; never a stub. */
  setIndex(items: WorkItemSummary[]): void {
    this.indexById.clear();
    for (const item of items) this.indexById.set(item.id, item);
  }

  /** The cached full item, or undefined if it has never been (successfully) fetched. */
  getItem(id: string): EpicWorkItem | undefined {
    return this.items.get(id);
  }

  /** Notes an expanded item's reference as a stub candidate, unless it dedupes (D-14): an id already
   * in the index, already fetched, or already a known stub resolves to that one box instead. */
  registerStub(link: EpicItemLink): void {
    if (link.in_index || this.indexById.has(link.id) || this.items.has(link.id)) return;
    if (this.stubs.has(link.id)) return;
    this.stubs.set(link.id, { id: link.id, title: link.title ?? link.id, relation: link.relation });
  }

  getStub(id: string): EpicStubRef | undefined {
    return this.stubs.get(id);
  }

  /** Fetches one item at most once per (id, expand) pair; a resolved fetch is cached and dedupes a
   * concurrent second call to the same key onto the same in-flight promise (FR-008, SC-003). */
  async fetchItem(id: string, expand?: string): Promise<EpicWorkItem | null> {
    if (!expand) {
      const cached = this.items.get(id);
      if (cached) return cached;
    }
    const key = expand ? `${id}::${expand}` : id;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const promise = this.inner
      .getEpicsItem(id, expand)
      .then((item) => {
        const merged = this.mergeStages(id, item);
        this.items.set(id, merged);
        this.stubs.delete(id);
        return merged;
      })
      .catch(() => null)
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }

  /** Each `expand` call only returns sections for the one stage matching that node id -- every
   * sibling stage comes back with sections: [] (speckit_source.py's `_stage_for`). Keeps any
   * previously fetched stage's sections instead of letting a later, differently-expanded fetch
   * wipe them out. */
  private mergeStages(id: string, item: EpicWorkItem): EpicWorkItem {
    const previous = this.items.get(id);
    if (!previous) return item;
    return {
      ...item,
      stages: item.stages.map((stage) => {
        if (stage.sections.length > 0) return stage;
        const cached = previous.stages.find((s) => s.kind === stage.kind && s.name === stage.name);
        return cached && cached.sections.length > 0 ? { ...stage, sections: cached.sections } : stage;
      }),
    };
  }

  /** Drops every cached item, in-flight fetch and stub -- the bridge's "changed" ping (D-08). */
  clearCache(): void {
    this.items.clear();
    this.pending.clear();
    this.stubs.clear();
  }

  async getNode(nodeId: string): Promise<HierarchyNodeRef | null> {
    if (!nodeId.startsWith("epic")) return this.inner.getNode(nodeId);
    if (nodeId.startsWith("epic::")) return this.itemRef(nodeId.slice("epic::".length));
    if (nodeId.startsWith("epic-ref::")) {
      const stub = this.stubs.get(nodeId.slice("epic-ref::".length));
      return stub ? this.stubRef(nodeId, stub) : null;
    }
    return null;
  }

  /** Every unrecognised `epic-`-prefixed id returns [] rather than delegating (FR-035, D-07). */
  async getChildren(nodeId: string): Promise<HierarchyNodeRef[]> {
    if (!nodeId.startsWith("epic")) return this.inner.getChildren(nodeId);
    if (nodeId.startsWith("epic::")) return this.childrenOfItem(nodeId.slice("epic::".length));
    if (nodeId.startsWith("epic-group::")) return this.childrenOfGroup(nodeId);
    return [];
  }

  private async childrenOfItem(id: string): Promise<HierarchyNodeRef[]> {
    const item = await this.fetchItem(id);
    if (!item) return [];
    const refs: HierarchyNodeRef[] = [];
    if (item.requirements.length > 0) refs.push(this.groupRef(id, "requirements", item.requirements.length));
    if (item.children.length > 0) refs.push(this.groupRef(id, "stories", item.children.length));
    return refs;
  }

  private childrenOfGroup(nodeId: string): HierarchyNodeRef[] {
    const [, id, group] = nodeId.split("::");
    const item = this.items.get(id);
    if (!item) return [];
    if (group === "requirements") {
      return item.requirements.map((requirement) => ({
        node_id: `epic-req::${id}::${requirement.id}`,
        name: requirement.text,
        level: "function",
        parent_id: nodeId,
        has_children: false,
        child_count: 0,
      }));
    }
    if (group === "stories") {
      return item.children.map((child) => ({
        node_id: `epic::${child.id}`,
        name: child.title,
        level: levelFor(child.kind),
        parent_id: nodeId,
        has_children: child.requirements.length > 0 || child.children.length > 0,
        child_count: child.requirements.length + child.children.length,
      }));
    }
    return [];
  }

  private itemRef(id: string): HierarchyNodeRef | null {
    const item = this.items.get(id);
    const summary = this.indexById.get(id);
    const source = item ?? summary;
    if (!source) return null;
    const groupCount = item ? Number(item.requirements.length > 0) + Number(item.children.length > 0) : 0;
    return {
      node_id: `epic::${id}`,
      name: source.title,
      level: levelFor(source.kind),
      parent_id: null,
      has_children: groupCount > 0,
      child_count: groupCount,
    };
  }

  private groupRef(id: string, group: "requirements" | "stories", count: number): HierarchyNodeRef {
    return {
      node_id: `epic-group::${id}::${group}`,
      name: group === "requirements" ? "Requirements" : "Stories",
      level: "function",
      parent_id: `epic::${id}`,
      has_children: count > 0,
      child_count: count,
    };
  }

  private stubRef(nodeId: string, stub: EpicStubRef): HierarchyNodeRef {
    return {
      node_id: nodeId,
      name: stub.title,
      level: "function",
      parent_id: null,
      has_children: false,
      child_count: 0,
    };
  }
}
