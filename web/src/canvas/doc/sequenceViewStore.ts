import { Store } from "../../state/createStore";
import { agentStore } from "../../agents/agentStore";

export interface SequenceView {
  /** Ids of the step (message) elements opened in place into their functions. */
  expanded: string[];
}

const STORAGE_PREFIX = "codechroma.sequence-view";

type Stored = Record<string, Partial<SequenceView>>;

/** Per active workspace, so one worktree's layer names never collide with another's. */
const storageKey = (): string => `${STORAGE_PREFIX}.${agentStore.getActiveWorkspace()}`;

function readStorage(): Stored {
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function writeStorage(stored: Stored): void {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(stored));
  } catch {
    // The page renders correctly without storage; the choice just won't survive a reload.
  }
}

/** Per-diagram sequence display prefs (which steps are expanded); never written to sequence.json. */
class SequenceViewStore extends Store {
  private stored: Stored | null = null;
  private storedKey = "";
  private version = 0;
  // Bumps only when the layout-relevant part changes (expanded steps), not on the player step.
  private layoutVersion = 0;
  private readonly steps = new Map<string, number | null>();

  getVersion = (): number => this.version;
  getLayoutVersion = (): number => this.layoutVersion;

  get(layer: string): SequenceView {
    const own = this.load()[layer] ?? {};
    return { expanded: Array.isArray(own.expanded) ? own.expanded.filter((id) => typeof id === "string") : [] };
  }

  isExpanded = (layer: string, id: string): boolean => this.get(layer).expanded.includes(id);

  /** Opens a step in place, or folds it back to its glance box. */
  toggleExpanded(layer: string, id: string): void {
    const { expanded } = this.get(layer);
    this.setExpanded(layer, expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id]);
  }

  getStep = (layer: string): number | null => this.steps.get(layer) ?? null;

  setStep(layer: string, step: number | null): void {
    this.steps.set(layer, step);
    this.bump(false);
  }

  setExpanded = (layer: string, expanded: string[]): void => this.update(layer, { expanded });

  /** Forgets the in-memory choices (saved ones stay and reload per workspace). */
  reset(): void {
    this.stored = null;
    this.steps.clear();
    this.bump(true);
  }

  private load(): Stored {
    const key = storageKey();
    if (!this.stored || this.storedKey !== key) {
      this.stored = readStorage();
      this.storedKey = key;
    }
    return this.stored;
  }

  private update(layer: string, patch: Partial<SequenceView>): void {
    const all = this.load();
    all[layer] = { ...all[layer], ...patch };
    writeStorage(all);
    this.bump("expanded" in patch);
  }

  private bump(layoutChanged: boolean): void {
    if (layoutChanged) this.layoutVersion += 1;
    this.version += 1;
    this.emit();
  }
}

export const sequenceViewStore = new SequenceViewStore();
