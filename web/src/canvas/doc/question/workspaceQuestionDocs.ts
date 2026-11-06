import type { EngineClient } from "../../../engine-client/EngineClient";
import { Store } from "../../../state/createStore";
import type { CanvasDoc } from "../../../state/types";
import { reportAsyncError } from "../../../util/reportError";
import { toQuestionView } from "./questionAdapter";
import { diagramSubgraph } from "./QuestionDiagram";

/** One watched workspace: its own client (answers post here) and its latest canvas doc. */
export interface WorkspaceQuestionSource {
  client: EngineClient;
  doc: CanvasDoc | null;
}

interface Watch {
  source: WorkspaceQuestionSource;
  /** What the published doc renders, to skip a refetch that changed nothing an agent window shows. */
  signature: string | null;
  /** Bumped by `stop()`, so a fetch still in flight drops its result. */
  seq: number;
  stop: () => void;
}

/** Everything an agent window renders from a doc: every question element (card + history) and its open questions' option diagrams with their arrows. */
function questionSignature(doc: CanvasDoc): string {
  const questions = Object.values(doc.elements).filter((el) => el.render === "question");
  const diagrams = questions
    .map(toQuestionView)
    .filter((q) => q.state === "open")
    .flatMap((q) => q.options.flatMap((o) => (o.diagramRef ? [diagramSubgraph(doc, o.diagramRef)] : [])))
    .map((nodes) => {
      const ids = new Set(nodes.map((n) => n.id));
      return [nodes, Object.values(doc.edges).filter((e) => ids.has(e.from) && ids.has(e.to))];
    });
  return JSON.stringify([questions, diagrams]);
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
    const watch: Watch = { source: { client, doc: null }, signature: null, seq: 0, stop: () => {} };
    let inFlight = false;
    let dirty = false;
    // At most one getCanvas in flight; pings that land meanwhile coalesce into one more fetch after it.
    const refetch = () => {
      if (inFlight) {
        dirty = true;
        return;
      }
      inFlight = true;
      dirty = false;
      const seq = watch.seq;
      client
        .getCanvas()
        .then((doc) => {
          if (seq !== watch.seq) return;
          const signature = questionSignature(doc);
          if (watch.source.doc && signature === watch.signature) return;
          watch.source = { client, doc };
          watch.signature = signature;
          this.publish();
        })
        .catch((cause: unknown) => {
          if (seq === watch.seq) reportAsyncError(`agent questions (${repoId})`, cause);
        })
        .finally(() => {
          inFlight = false;
          if (dirty && seq === watch.seq) refetch();
        });
    };
    const unsubscribe = client.subscribeCanvas(refetch);
    watch.stop = () => {
      watch.seq++;
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
