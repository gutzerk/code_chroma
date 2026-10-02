import { isAbortError, type EngineClient } from "../engine-client/EngineClient";
import type { ChangeCard, FunctionDiff } from "./types";
import { changeCardStore } from "./changeCardStore";
import { registerWorkspaceStore } from "./createStore";
import { diffOverlayStore } from "./diffOverlayStore";
import { hierarchyChangesStore } from "./hierarchyChangesStore";
import { revealDiffEntry } from "./revealDiffEntry";
import { revealNode, type NodeRefCache } from "./revealNode";

export interface DiffRefresh {
  diffs: FunctionDiff[];
  cards: ChangeCard[];
}

/** Fetches every current diff and change card, reveals each entry's block (idempotent — an
 * already-open window isn't moved or reopened), and publishes both to their stores. No camera framing
 * here on purpose: this runs on every live update and after every Accept click, not just the one-time
 * Diff-toggle activation, which frames the whole revealed set itself.
 *
 * 🔴 `signal` really cancels: it aborts the in-flight fetches (see EngineClient's requestSignal), so
 * a cancelled activation stops the request storm instead of merely declining to publish it. An
 * aborted run resolves to `null` rather than rejecting — being called off is not a failure, and every
 * caller already treats `null` as "nothing to frame".
 *
 * Both layers move together on purpose. They were two fetches in the three call sites that publish a
 * diff (the Diff-toggle activation, the live reconciler, and Accept), and keeping them in one function
 * is what stops a card surviving a diff that has just been accepted away. */
export async function refreshDiffs(
  engineClient: EngineClient,
  signal?: AbortSignal,
): Promise<DiffRefresh | null> {
  let entries: FunctionDiff[];
  let cardSet: Awaited<ReturnType<EngineClient["getChangeCards"]>> | null;
  try {
    [entries, cardSet] = await Promise.all([
      engineClient.getDiff(signal),
      // Caught on its own: an older bridge without the route must not take the diff layer down too.
      engineClient.getChangeCards(signal).catch(() => null),
    ]);
  } catch (err) {
    if (isAbortError(err)) return null;
    throw err;
  }
  if (signal?.aborted) return null;
  const cards = withoutDiffedNodes(cardSet?.cards ?? [], entries);
  // 🔴 One cache for the whole run: sibling entries share nearly every ancestor, so without it each
  // entry re-fetched the same chain — the request storm that made Diff never finish on a large PR.
  const nodeRefs: NodeRefCache = new Map();
  // Every walk below is independent of every other, so they all run concurrently rather than in two
  // sequential passes — the difference is significant once there are more than a handful of changes.
  // Cards need only the ancestor reveal (no showCode), and withoutDiffedNodes already made their
  // ids disjoint from the entries'.
  await Promise.all([
    ...entries
      .filter((entry) => entry.status !== "deleted")
      .map(async (entry) => {
        await revealNode(entry.node_id, engineClient, nodeRefs, signal);
        revealDiffEntry(entry);
      }),
    ...[...new Set(cards.map((card) => card.node_id))].map((nodeId) =>
      revealNode(nodeId, engineClient, nodeRefs, signal),
    ),
  ]);
  if (signal?.aborted) return null;
  publish(entries, cards, cardSet?.by_node_status ?? null);
  return { diffs: entries, cards };
}

/** The scheduler's single-flight state: which client owns the run in flight, its abort handle, and
 * whether a ping arrived during it. A class rather than module `let`s so it can join the workspace
 * reset set below, exactly like every Store does — and so `reset()` can abort the run it drops
 * instead of leaving it fetching for a workspace nobody is looking at. */
class RefreshScheduler {
  runningFor: EngineClient | null = null;
  rerunQueued = false;
  private controller: AbortController | null = null;

  claim(client: EngineClient): AbortSignal {
    this.runningFor = client;
    this.controller = new AbortController();
    return this.controller.signal;
  }

  reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.runningFor = null;
    this.rerunQueued = false;
  }
}

const scheduler = new RefreshScheduler();
// 🔴 Workspace-scoped like the stores: without this, a switch mid-run leaves the old client owning
// the flag, so the new workspace's first ping is swallowed into rerunQueued and then re-runs against
// the workspace the user just left, publishing its diffs into the shared stores.
registerWorkspaceStore(scheduler);

/**
 * Single-flight refreshDiffs for the live path: a refresh arriving mid-run queues one trailing
 * rerun instead of cancelling the run in flight.
 *
 * 🔴 Cancelling was the bug. refreshDiffs bails before publish() when shouldAbort() is true, and
 * the live reconciler used to flip its `cancelled` flag on every "changed" ping — so under a ping
 * stream (a flapping events socket resyncs at up to 1/s, an agent writing files, a big PR) no run
 * ever reached publish() and the diff layer never landed at all. Coalescing bounds a whole storm to
 * the run in flight plus one more, and guarantees the last one publishes.
 */
export function scheduleRefreshDiffs(engineClient: EngineClient): void {
  if (scheduler.runningFor !== null) {
    scheduler.rerunQueued = true;
    return;
  }
  // 🔴 A workspace switch calls reset(), which aborts this signal: the run stops fetching and bails
  // before publish(), so a departed workspace's diffs never land in the shared stores. The same
  // ownership test gates the cleanup, so a run finishing late can't clear a slot a newer run took.
  const signal = scheduler.claim(engineClient);
  void refreshDiffs(engineClient, signal)
    .catch((err: unknown) => {
      console.error("[diff] scheduleRefreshDiffs failed", err);
    })
    .finally(() => {
      if (scheduler.runningFor !== engineClient) return;
      const rerun = scheduler.rerunQueued;
      scheduler.reset();
      if (rerun) scheduleRefreshDiffs(engineClient);
    });
}

/** Drops the scheduler's in-flight/queued state — what resetWorkspaceStores() calls on a switch. */
export function resetRefreshDiffs(): void {
  scheduler.reset();
}

/** Drops cards whose node already shows a full diff panel, so the two layers don't say the same
 * thing twice on the same block. What survives is what a diff panel can't carry: a changed class or
 * module-level symbol, a deleted symbol whose node is gone, a non-code file. */
function withoutDiffedNodes(cards: ChangeCard[], diffs: FunctionDiff[]): ChangeCard[] {
  const diffed = new Set(diffs.map((diff) => diff.node_id));
  return cards.filter((card) => !diffed.has(card.node_id));
}

function publish(
  diffs: FunctionDiff[],
  cards: ChangeCard[],
  byNodeStatus: Record<string, string> | null,
): void {
  diffOverlayStore.setDiffs(diffs);
  changeCardStore.setSteps(cards);
  if (byNodeStatus) hierarchyChangesStore.setStatuses(byNodeStatus);
  else hierarchyChangesStore.clear();
}
