import type { EngineClient } from "../../../engine-client/EngineClient";
import { Store } from "../../../state/createStore";
import type { CanvasDoc } from "../../../state/types";
import { reportAsyncError } from "../../../util/reportError";

/** One watched workspace: its own client (answers post here) and its latest canvas doc. */
export interface WorkspaceQuestionSource {
  client: EngineClient;
  doc: CanvasDoc | null;
}

interface Watch {
  source: WorkspaceQuestionSource;
  seq: number;
  stop: () => void;
}

/** The canvas docs of the agent workspaces the canvas is NOT drawing, so an agent window shows its own questions whatever tab is active. */
class WorkspaceQuestionDocs extends Store {
  private readonly watches = new Map<string, Watch>();
  private docs: CanvasDoc[] = [];

  /** The source for one workspace id, or undefined while it is not watched. */
  getSource = (repoId: string): WorkspaceQuestionSource | undefined => this.watches.get(repoId)?.source;

  /** Every loaded doc; the same array until one changes, so it can key a cache. */
  getDocs = (): CanvasDoc[] => this.docs;

  /** Watches exactly `repoIds`: starts the new ones, stops (and disposes) the rest. */
  retain(repoIds: readonly string[], makeClient: (repoId: string) => EngineClient): void {
    const wanted = new Set(repoIds);
    let changed = false;
    for (const [id, watch] of this.watches) {
      if (wanted.has(id)) continue;
      watch.stop();
      this.watches.delete(id);
      changed = true;
    }
    for (const id of wanted) {
      if (this.watches.has(id)) continue;
      this.watches.set(id, this.start(id, makeClient(id)));
      changed = true;
    }
    if (changed) this.publish();
  }

  private start(repoId: string, client: EngineClient): Watch {
    let stopped = false;
    const watch: Watch = { source: { client, doc: null }, seq: 0, stop: () => {} };
    const refetch = () => {
      const seq = ++watch.seq;
      client
        .getCanvas()
        .then((doc) => {
          if (stopped || seq !== watch.seq) return;
          watch.source = { client, doc };
          this.publish();
        })
        .catch((cause: unknown) => {
          if (!stopped) reportAsyncError(`agent questions (${repoId})`, cause);
        });
    };
    const unsubscribe = client.subscribeCanvas(refetch);
    watch.stop = () => {
      stopped = true;
      unsubscribe();
      client.dispose?.();
    };
    refetch();
    return watch;
  }

  private publish(): void {
    this.docs = [...this.watches.values()].flatMap((watch) => (watch.source.doc ? [watch.source.doc] : []));
    this.emit();
  }

  /** Stops every watch; global (never reset by a workspace switch), so only tests call it. */
  reset(): void {
    for (const watch of this.watches.values()) watch.stop();
    this.watches.clear();
    this.publish();
  }
}

export const workspaceQuestionDocs = new WorkspaceQuestionDocs().markGlobalStore();
