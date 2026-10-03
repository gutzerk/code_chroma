import type {
  AgentEvent,
  C1Coverage,
  CanvasBatch,
  CanvasBatchResult,
  CanvasDoc,
  CanvasPing,
  ChangeCardSet,
  Connection,
  Diagram,
  DiagramFetchKind,
  DiagramGenerationOptions,
  DiagramGenerationStatus,
  DiagramKind,
  DiagramLayout,
  DiagramsStatus,
  DiagramTypeSummary,
  EpicBriefJobState,
  EpicsIndex,
  EpicWorkItem,
  FunctionDiff,
  HierarchyNodeRef,
  ImpactChanges,
  LayoutKind,
  SourceFragment,
  Trace,
  TraceStreamMessage,
  TraceSummary,
  WikiGeneralStatus,
} from "../state/types";
import { errorMessageFrom } from "../util/httpJson";

/** What `getDiagram(kind)` resolves to, per kind — so the caller needs no cast. 036-shared-diagram-
 * style-catalog: c1/patterns/impact and every `` `custom/${typeId}` `` member of DiagramFetchKind
 * now resolve to the one shared `Diagram` shape (`resolve_diagram()` on the bridge side); only
 * "epics" stays its own index, an unrelated subsystem. The index signature stays (rather than
 * collapsing to `Record<string, Diagram>`) so `epics` keeps its own distinct value type. */
export interface DiagramPayload {
  c1: Diagram;
  patterns: Diagram;
  impact: Diagram;
  epics: EpicsIndex;
  [key: `custom/${string}`]: Diagram;
}

/** `DiagramPayload[K]` for a generic `K` — mixing named properties with a template-literal index
 * signature makes plain indexed access (`DiagramPayload[K]`) resolve to an intersection of every
 * possible value type when `K` is generic, not the one matching branch. Use this instead wherever
 * `K extends DiagramFetchKind` is generic; literal-keyed access (e.g. `DiagramPayload["c1"]`, or a
 * mapped type over a literal union) still works fine and needs no change. */
export type DiagramPayloadFor<K extends DiagramFetchKind> = K extends `custom/${string}`
  ? Diagram
  : K extends keyof DiagramPayload
    ? DiagramPayload[K]
    : never;

/** Every named overlay/addon `getSidecar`/`subscribeSidecar` can fetch (037, US2) — replaces the
 * bespoke pairs (`getC1Changes`/`getC1Coverage`) with one method per operation, keyed by name, the
 * same collapse `getDiagram(kind)` already did for the diagrams themselves. Used to also carry
 * `"review"` (the Impact judgmental review sidecar), removed rather than left half-wired (038
 * follow-up) once that review flow itself was removed; `"changes"` (the explanatory axis) moved
 * from c1 to impact in the same follow-up. */
export type SidecarKind = "changes" | "coverage";

export interface SidecarPayload {
  changes: ImpactChanges;
  coverage: C1Coverage;
}

/** Every kind the bridge runs a headless skill for. `impact-changes` has no plain GET or layout (its
 * payload carries review comments and a fingerprint), but its generate/status/output trio comes
 * from the same server-side factory, so it shares those methods. `wiki-general` is the same story --
 * a markdown page tree, not a canvas diagram (docs/architecture/wiki-general.md), sharing only the
 * generate/cancel/output trio; its own richer status shape is `getWikiGeneralStatus` below. */
export type SkillRunKind = DiagramKind | "impact-changes" | "wiki-general";

/** Every kind `subscribeDiagram` can listen for: the skill-run kinds plus "epics", whose index is
 * refetched off the shared "changed" ping today but keeps the same per-kind channel shape. Bare
 * `"custom"` is the one coarse ping every custom type shares (`workspaces.py`'s `on_custom_change`
 * emits `{"type": "custom"}`, never `custom/<id>`), so a listener must refetch the whole type list. */
export type DiagramEventKind = SkillRunKind | DiagramFetchKind | "custom";

/**
 * Facade over the local HTTP+WebSocket bridge in front of epic 001's GraphEngine
 * (contracts/canvas-bridge-api.md). UI components depend on this interface, never on
 * fetch/WebSocket details directly.
 */
export interface EngineClient {
  /** Resolves a single node ref. `signal` cancels the fetch outright (see revealNode's batch walk,
   * which is the one caller that can be called off mid-flight). */
  getNode(nodeId: string, signal?: AbortSignal): Promise<HierarchyNodeRef | null>;
  /** Direct children only, fetched lazily on each block expand (FR-002). */
  getChildren(nodeId: string): Promise<HierarchyNodeRef[]>;
  /** Dependency + dependent edges touching this node, mirroring GraphEngine's
   * get_dependencies/get_dependents (src/codechroma/engine.py). */
  getConnections(nodeId: string): Promise<Connection[]>;
  /** The dependency path between two nodes, if one exists (GET /repos/{id}/route?from=&to=) — powers
   * the "Trace route" action on a two-node selection. Resolves to `null` when the nodes are
   * unrelated, never rejects for that case. */
  getRoute(fromId: string, toId: string): Promise<string[] | null>;
  /** Every current FUNCTION node whose source differs from its git-HEAD version (GET
   * /repos/{id}/diff) — powers the canvas's global "Diff" toggle. */
  getDiff(signal?: AbortSignal): Promise<FunctionDiff[]>;
  /** Every change vs the workspace's diff base as a card on the nearest existing block (GET
   * /repos/{id}/change-cards) — the second layer of the same "Diff" toggle. */
  getChangeCards(signal?: AbortSignal): Promise<ChangeCardSet>;
  /** Commits nodeId's pending diff to git (POST /repos/{id}/diff/{nodeId}/accept) — the diff
   * panel's corner "Accept" button. Rejects with a readable message on 404/409/500. */
  acceptDiff(nodeId: string): Promise<void>;
  /** Subscribes to the bridge's live "changed" pings (WS /repos/{id}/events), fired after the
   * server reanalyzes an on-disk edit. Returns an unsubscribe fn. The mock never fires. */
  subscribe(onChange: () => void): () => void;
  /** One diagram type's payload (GET /repos/{id}/{kind}) — `c1` powers the C1 view toggle,
   * `patterns` the Patterns one, `epics` the Epics view's index. The bridge serves every kind
   * under this one route shape, so the client exposes one method per operation rather than one per
   * (kind × operation): adding a diagram is a kind member here and a `DiagramSpec` entry
   * server-side, nothing more. Never a 4xx/5xx for `epics`, even with no requirements source. */
  getDiagram<K extends DiagramFetchKind>(kind: K): Promise<DiagramPayloadFor<K>>;
  /** The user's saved box positions for a kind (GET /repos/{id}/{kind}/layout) — restored on mount.
   * `"hierarchy"` isn't a DiagramKind (no generate/status/output, nothing AI-authored to fetch via
   * getDiagram) but shares this same layout GET/POST shape. */
  getDiagramLayout(kind: LayoutKind): Promise<DiagramLayout>;
  /** Persists the user's dragged box positions (POST /repos/{id}/{kind}/layout). */
  saveDiagramLayout(kind: LayoutKind, layout: DiagramLayout): Promise<void>;
  /** The one canvas document (GET /repos/{id}/canvas) — 016-single-canvas-dashboard, Stage 1's
   * `CanvasDoc.model_dump()` verbatim. Never rejects on a missing file: an unstarted canvas is an
   * empty document, same as EMPTY_CANVAS_DOC. */
  getCanvas(): Promise<CanvasDoc>;
  /** Applies one batch of ops (PATCH /repos/{id}/canvas) — the one write point onto the document.
   * Resolves even when the batch is rejected (`{ok: false, errors}`); never throws for a bad op. */
  patchCanvas(batch: CanvasBatch): Promise<CanvasBatchResult>;
  /** Subscribes to the bridge's richer "canvas" pings (batch_id/affected/new_elements), fired by a
   * successful PATCH and by the canvas-file watcher for a write that skipped the route. Same shared
   * socket as subscribe(). Returns an unsubscribe fn. The mock never fires. */
  subscribeCanvas(onChange: (ping: CanvasPing) => void): () => void;
  /** Runs one recipe (POST /repos/{id}/recipes/{recipe}/run) — 016-single-canvas-dashboard, Stage 4.
   * `recipe` is a built-in name (c1/patterns/impact/epics) or `` `custom/${typeId}` ``. Reconciles
   * that recipe's own layer against its freshly resolved payload; resolves even when the batch is
   * rejected, same as patchCanvas. */
  runRecipe(recipe: string): Promise<CanvasBatchResult>;
  /** Which diagram artifacts already exist on disk (GET /repos/{id}/diagrams/status) — the
   * "Diagrams" menu's readiness signal, so it never offers a click that silently does nothing. */
  getDiagramsStatus(): Promise<DiagramsStatus>;
  /** Deletes this repo's own diagram instance file (DELETE /repos/{id}/{kind}) — never a saved
   * custom-type definition in the shared library. `{deleted: false}` when nothing was there, so a
   * caller can retry after a partial failure without treating "already gone" as an error. */
  deleteDiagram(kind: string): Promise<{ deleted: boolean }>;
  /** Subscribes to the bridge's per-kind ping, fired after that diagram's JSON is rewritten. Same
   * shared socket as subscribe(). Returns an unsubscribe fn. The mock never fires. */
  subscribeDiagram(kind: DiagramEventKind, onChange: () => void): () => void;
  /** Kicks off a headless `claude -p` run of the kind's skill (POST /repos/{id}/{kind}/generate),
   * unless one is already running for this repo. `onlyIfMissing` makes the bridge refuse to start a
   * run when a valid artifact is already on disk — the backstop for the automatic trigger, so a
   * diagram is never overwritten by a run nobody asked for. */
  generateDiagram(
    kind: SkillRunKind,
    options?: DiagramGenerationOptions,
  ): Promise<DiagramGenerationStatus>;
  /** Cancels an in-flight background run for `kind` (POST /repos/{id}/{kind}/cancel), killing the
   * `claude` process and resetting the job to idle. Safe to call when nothing is running. */
  cancelDiagram(kind: SkillRunKind): Promise<DiagramGenerationStatus>;
  /** Current state of the background generation job (GET /repos/{id}/{kind}/status). */
  getDiagramStatus(kind: SkillRunKind): Promise<DiagramGenerationStatus>;
  /** Subscribes to the bridge's "{kind}-status" pushes, fired as the background job progresses.
   * Same shared socket as subscribe(). Returns an unsubscribe fn. The mock never fires. */
  subscribeDiagramStatus(
    kind: SkillRunKind,
    onChange: (status: DiagramGenerationStatus) => void,
  ): () => void;
  /** Progress lines the run has rendered so far (GET /repos/{id}/{kind}/output) — the catch-up read
   * for a canvas that opened part-way through a run. */
  getDiagramOutput(kind: SkillRunKind): Promise<string[]>;
  /** Subscribes to the bridge's "{kind}-output" batches, pushed as the run works. Same shared
   * socket as subscribe(). Returns an unsubscribe fn. The mock never fires. */
  subscribeDiagramOutput(kind: SkillRunKind, onLines: (lines: string[]) => void): () => void;
  /** GET /repos/{id}/wiki-general/status: the background job's state plus whether a valid
   * .codechroma/wiki-general/ already exists on disk. generate/cancel/output for "wiki-general" use
   * the generic SkillRunKind methods above; this one exists because its response shape is wider than
   * plain DiagramGenerationStatus. */
  getWikiGeneralStatus(): Promise<WikiGeneralStatus>;
  /** POST /repos/{id}/wiki-general/update: patches only the pages a commit affected, never wipes the
   * tree -- distinct from generateDiagram("wiki-general"), which always does a full rebuild. */
  updateWikiGeneral(): Promise<DiagramGenerationStatus>;
  /** One overlay/addon's payload by name (037, US2) — `"changes"` (GET /repos/{id}/impact-changes),
   * `"coverage"` (`.coverage` off GET /repos/{id}/c1/context, US4's unified envelope). */
  getSidecar<K extends SidecarKind>(kind: K): Promise<SidecarPayload[K]>;
  /** Subscribes to the named overlay/addon's own watcher ping. Same shared socket as subscribe().
   * Returns an unsubscribe fn. The mock never fires. */
  subscribeSidecar(kind: SidecarKind, onChange: () => void): () => void;
  /** Summaries of every recorded execution trace (GET /repos/{id}/traces) — powers the trace picker. */
  listTraces(): Promise<TraceSummary[]>;
  /** One recorded trace's ordered steps for replay (GET /repos/{id}/traces/{id}). */
  getTrace(traceId: string): Promise<Trace>;
  /** Subscribes to the bridge's "trace" pings, fired when a trace file appears/changes on disk.
   * Same shared events socket as subscribe(). Returns an unsubscribe fn. The mock never fires. */
  subscribeTrace(onChange: () => void): () => void;
  /** Taps the live WS /repos/{id}/trace-stream, delivering each streamed run event. Returns an
   * unsubscribe fn that also closes the socket when the last listener leaves. The mock never fires. */
  subscribeTraceStream(onEvent: (message: TraceStreamMessage) => void): () => void;
  /** Subscribes to the agent lifecycle pings (`agent-added` / `agent-removed` / `agent-status` /
   * `workspace-activated`) on the same shared events socket — no second socket for the agent layer.
   * Returns an unsubscribe fn. The mock never fires. */
  subscribeAgents(onEvent: (message: AgentEvent) => void): () => void;
  /** One fully-loaded work item (GET /repos/{id}/epics/items/{id}); `expand` names one stage node
   * id to populate its sections. Rejects with a readable message on 404. */
  getEpicsItem(itemId: string, expand?: string): Promise<EpicWorkItem>;
  /** A slice of a workspace file (GET /repos/{id}/source?path=..&start=..&end=..) — the backing
   * text an epics block links to. Both line bounds optional; absent means the whole file. Optional
   * on the interface so minimal test stubs don't all need it; callers guard with `?.`. */
  getSourceFragment?(
    path: string,
    range?: { start?: number; end?: number },
  ): Promise<SourceFragment>;
  /** Starts (or attaches to) an epic's AI-brief generation (POST /repos/{id}/epics/{itemId}/brief)
   * — a cached brief is returned inline without re-running the skill. `force` skips that cache and
   * regenerates the brief, even one already on disk. Rejects with a readable message on 404
   * (unknown epic id). */
  generateEpicBrief(itemId: string, force?: boolean): Promise<EpicBriefJobState>;
  /** Polls one epic's brief job (GET /repos/{id}/epics/{itemId}/brief) for its state and, once
   * done, its brief. */
  getEpicBrief(itemId: string): Promise<EpicBriefJobState>;
  /** Cancels an in-flight brief run for `itemId` (POST .../epics/{itemId}/brief/cancel), killing
   * the `claude` process and resetting the job to idle. Safe to call when nothing is running. */
  cancelEpicBrief(itemId: string): Promise<EpicBriefJobState>;
  /** The brief run's progress lines so far (GET /repos/{id}/epics/{itemId}/brief/output). */
  getEpicBriefOutput(itemId: string): Promise<string[]>;

  // --- feature 011: user-defined custom diagrams -- cross-project library ---
  // Not repo-scoped (no `/repos/{id}` prefix): a diagram *type* lives in the user's home directory
  // library, reused across every repo. Only the generated diagram itself (getDiagram/generateDiagram
  // etc. above, with kind `` `custom/${typeId}` ``) is per-repo. The in-app interview that used to
  // author a new type from the canvas is retired (diagram-management unification) -- the library
  // itself, and a type saved into it by hand or by direct API/skill use, still resolve and draw fine.
  /** Every saved diagram-type definition's summary (GET /diagram-types). */
  listDiagramTypes(): Promise<DiagramTypeSummary[]>;
  /** Closes the shared events socket and any trace-stream socket, cancels reconnect timers and
   * drops every listener. EngineClientProvider calls this when the workspace switches, so a
   * session never accumulates one abandoned socket per switch. Optional: stubs and the mock have
   * nothing to release. */
  dispose?(): void;
}

/** The five agent-lifecycle messages, fanned out to one listener set each but delivered together. */
export const AGENT_EVENT_TYPES = [
  "agent-added",
  "agent-removed",
  "agent-status",
  "workspace-activated",
  "branch-changed",
] as const;

type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** Message `type` values the shared events socket fans out, each with its own listener set.
 * Derived from the kind unions rather than hand-listed, so a new skill-run family (including the
 * open-ended `` `custom/${typeId}` `` one) widens this automatically instead of needing casts. */
type EventType =
  | "changed"
  | "trace"
  | "canvas"
  | DiagramEventKind
  | `${SkillRunKind}-status`
  | `${SkillRunKind}-output`
  | AgentEventType;

/** The bridge's own id for the analyzed repository; a ping with no workspace key belongs to it. */
const MAIN_WORKSPACE = "main";

/** Hard ceiling on a bridge *read*. Nothing on the canvas benefits from a fetch that outlives the
 * user's patience, and an unbounded one strands whatever is awaiting it.
 *
 * 🔴 Reads only — see `isRead`. Timing out a GET costs a retry; timing out `acceptDiff`'s POST does
 * not stop the commit the bridge is already making, it only stops us hearing the result, so the user
 * is told a commit failed that in fact landed. A write is bounded by its caller's own signal or not
 * at all. */
const READ_TIMEOUT_MS = 30_000;

/** A GET (no method, or an explicit "GET") — the only kind of request the blanket timeout applies to,
 * because it's the only kind that can be safely retried after being called off. */
function isRead(init?: RequestInit): boolean {
  return init?.method === undefined || init.method === "GET";
}

/** The caller's own cancellation combined with the read timeout, so whichever fires first aborts the
 * fetch. `AbortSignal.any` is what makes "cancel" and "give up" one mechanism instead of two.
 *
 * ⚠ Both `AbortSignal.any` and `AbortSignal.timeout` are recent (Safari 17.4, Chrome 116). Missing
 * either just drops the timeout half rather than throwing: a slow read is a far smaller problem than
 * every single request failing on an older browser. */
function requestSignal(init?: RequestInit, signal?: AbortSignal): AbortSignal | undefined {
  if (!isRead(init) || typeof AbortSignal.timeout !== "function") return signal;
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  if (!signal) return timeout;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;
}

/** True for the two ways a request can be called off — a caller's abort, or the blanket timeout.
 * Callers use it to stay quiet about a cancellation they asked for, while still reporting real
 * failures. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** First events-socket retry delay — a restarting bridge should still come back quickly. */
const RECONNECT_BASE_MS = 1000;
/** Ceiling for the doubling retry, so a bridge that's simply gone is polled twice a minute. */
const RECONNECT_MAX_MS = 30_000;
/** How long a connection must last to count as healthy and earn the base delay back. */
const RECONNECT_STABLE_MS = 10_000;

/** Route/topic per `SidecarKind` — the one place that still knows each overlay's own URL shape,
 * so `getSidecar`/`subscribeSidecar` stay one method each (037, US2). */
const SIDECAR_ROUTES: Record<SidecarKind, string> = {
  changes: "/impact-changes",
  coverage: "/c1/context",
};
const SIDECAR_TOPICS: Record<SidecarKind, EventType> = {
  changes: "impact-changes",
  coverage: "c1",
};

export class HttpEngineClient implements EngineClient {
  // One shared socket multiplexes every subscriber, reopened on drop so the canvas keeps
  // receiving live pings across bridge restarts.
  private socket: WebSocket | null = null;
  // One listener set per message type, created on first subscribe, so adding an event kind is a
  // string in EventType rather than a new field, subscribe method, dispatch branch and reconnect
  // condition -- and a kind the bridge never pings (epics) needs no placeholder entry.
  private readonly listeners = new Map<EventType, Set<(payload: never) => void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private traceStreamSocket: WebSocket | null = null;
  private traceReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly traceStreamListeners = new Set<(message: TraceStreamMessage) => void>();
  // Every ping sent while the socket was down is lost, so a reopen must nudge a re-fetch (2nd+ open).
  private everConnected = false;
  // 🔴 Backs off, because each reopen replays every bare-ping listener via notifyResync() -- and one
  // synthetic "changed" fans out to the diff refresh, the C1 review, the canvas doc and one children
  // fetch per expanded block. At the old flat 1s retry a socket that couldn't stay up replayed all of
  // that every second, which reads exactly like an infinite loop.
  private reconnectDelayMs = RECONNECT_BASE_MS;
  // When the current socket opened, or 0 while it's down. Only a connection that lasted earns the
  // short retry back -- resetting on open alone would leave an open-then-instantly-drop socket
  // retrying at the base delay forever, which is the flap the backoff exists to damp.
  private socketOpenedAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly repoId: string,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl}/repos/${this.repoId}${path}`;
  }

  /** The diagram-type library/interview routes are NOT repo-scoped (see EngineClient's own doc on
   * this section) — a definition lives in the user's home directory, not under `/repos/{id}`. */
  private libraryUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /** The one place a URL is actually fetched — repo-scoped `request`/`getJsonOrNull` and their
   * library-scoped counterparts all resolve their own base URL, then share this body.
   *
   * 🔴 A read that never settles used to strand whoever was awaiting it with no way out: that is why
   * the Diff toggle once needed a "cancel" that only suppressed the publish while the request storm
   * kept running. READ_TIMEOUT_MS is the floor for a GET; a caller that can be cancelled (the Diff
   * activation) also passes its own signal, and the two combine so whichever fires first aborts the
   * actual fetch. A write carries the caller's signal only — see READ_TIMEOUT_MS's own note. */
  private async fetchJson<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
    const response = await fetch(url, { ...init, signal: requestSignal(init, signal) });
    if (!response.ok) {
      throw new Error(await errorMessageFrom(response));
    }
    return (await response.json()) as T;
  }

  /** Like fetchJson, but a 404 resolves to null instead of rejecting -- for lookups where "not
   * found" is an expected outcome, not an error. */
  private async fetchJsonOrNull<T>(url: string, signal?: AbortSignal): Promise<T | null> {
    // Always a GET, so it always earns the read timeout.
    const response = await fetch(url, { signal: requestSignal(undefined, signal) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(await errorMessageFrom(response));
    return (await response.json()) as T;
  }

  private libraryRequest<T>(path: string, init?: RequestInit): Promise<T> {
    return this.fetchJson<T>(this.libraryUrl(path), init);
  }

  private request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
    return this.fetchJson<T>(this.url(path), init, signal);
  }

  private getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, undefined, signal);
  }

  private getJsonOrNull<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    return this.fetchJsonOrNull<T>(this.url(path), signal);
  }

  /** The `{method, headers, body}` shape every JSON-bodied mutation sends -- shared by
   * `postJson`/`patchJson` so a call site never hand-writes the stringify/header boilerplate. */
  private static jsonInit(method: string, body?: unknown): RequestInit {
    return {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    };
  }

  private postJson<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, HttpEngineClient.jsonInit("POST", body));
  }

  private patchJson<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, HttpEngineClient.jsonInit("PATCH", body));
  }

  private deleteJson<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  /** Registers `listener` for one event type and returns its unsubscribe fn. */
  private on<T>(type: EventType, listener: (payload: T) => void): () => void {
    let set = this.listeners.get(type) as Set<(payload: T) => void> | undefined;
    if (!set) {
      set = new Set();
      this.listeners.set(type, set as Set<(payload: never) => void>);
    }
    set.add(listener);
    this.ensureSocket();
    return () => {
      set.delete(listener);
    };
  }

  // --- one method per operation, keyed by kind; the bridge serves every kind the same way ---

  getDiagram<K extends DiagramFetchKind>(kind: K): Promise<DiagramPayloadFor<K>> {
    return this.getJson<DiagramPayloadFor<K>>(`/${kind}`);
  }

  subscribeDiagram(kind: DiagramEventKind, onChange: () => void): () => void {
    return this.on(kind, onChange);
  }

  generateDiagram(
    kind: SkillRunKind,
    options?: DiagramGenerationOptions,
  ): Promise<DiagramGenerationStatus> {
    // Query keeps onlyIfMissing for the auto-trigger's on-disk short-circuit, and source (plus, for
    // a plan, the feature dir) for the impact skill's slice; the body carries the regenerate-only
    // free-text note (stripped by the route, so an empty one is just a plain generate).
    const params = new URLSearchParams();
    if (options?.onlyIfMissing) params.set("only_if_missing", "true");
    if (options?.source) params.set("source", options.source);
    if (options?.feature) params.set("feature", options.feature);
    const query = params.toString() ? `?${params.toString()}` : "";
    const body = {
      onlyIfMissing: options?.onlyIfMissing ?? false,
      updateInstructions: options?.updateInstructions ?? "",
    };
    return this.postJson<DiagramGenerationStatus>(`/${kind}/generate${query}`, body);
  }

  getDiagramStatus(kind: SkillRunKind): Promise<DiagramGenerationStatus> {
    return this.getJson<DiagramGenerationStatus>(`/${kind}/status`);
  }

  cancelDiagram(kind: SkillRunKind): Promise<DiagramGenerationStatus> {
    return this.postJson<DiagramGenerationStatus>(`/${kind}/cancel`);
  }

  subscribeDiagramStatus(
    kind: SkillRunKind,
    onChange: (status: DiagramGenerationStatus) => void,
  ): () => void {
    return this.on<DiagramGenerationStatus>(`${kind}-status`, onChange);
  }

  async getDiagramOutput(kind: SkillRunKind): Promise<string[]> {
    return (await this.getJson<{ lines: string[] }>(`/${kind}/output`)).lines;
  }

  subscribeDiagramOutput(kind: SkillRunKind, onLines: (lines: string[]) => void): () => void {
    return this.on<{ lines: string[] }>(`${kind}-output`, (m) => onLines(m.lines));
  }

  getWikiGeneralStatus(): Promise<WikiGeneralStatus> {
    return this.getJson<WikiGeneralStatus>("/wiki-general/status");
  }

  updateWikiGeneral(): Promise<DiagramGenerationStatus> {
    return this.postJson<DiagramGenerationStatus>("/wiki-general/update");
  }

  getDiagramLayout(kind: LayoutKind): Promise<DiagramLayout> {
    return this.getJson<DiagramLayout>(`/${kind}/layout`);
  }

  async saveDiagramLayout(kind: LayoutKind, layout: DiagramLayout): Promise<void> {
    await this.postJson<unknown>(`/${kind}/layout`, layout);
  }

  getCanvas(): Promise<CanvasDoc> {
    return this.getJson<CanvasDoc>("/canvas");
  }

  patchCanvas(batch: CanvasBatch): Promise<CanvasBatchResult> {
    return this.patchJson<CanvasBatchResult>("/canvas", batch);
  }

  subscribeCanvas(onChange: (ping: CanvasPing) => void): () => void {
    return this.on("canvas", onChange);
  }

  runRecipe(recipe: string): Promise<CanvasBatchResult> {
    return this.postJson<CanvasBatchResult>(`/recipes/${recipe}/run`);
  }

  getDiagramsStatus(): Promise<DiagramsStatus> {
    return this.getJson<DiagramsStatus>("/diagrams/status");
  }

  deleteDiagram(kind: string): Promise<{ deleted: boolean }> {
    return this.deleteJson<{ deleted: boolean }>(`/${kind}`);
  }

  async getNode(nodeId: string, signal?: AbortSignal): Promise<HierarchyNodeRef | null> {
    // The route deliberately answers a missing node with a real 404 (see graph.py's get_node: "not
    // 200/null: a null body reads identically to 'hasn't arrived yet' client-side") -- getJsonOrNull
    // is the one that actually turns that into `null` instead of throwing, which every caller
    // (useInspectorNode's own "no longer exists" message included) already relies on.
    return this.getJsonOrNull<HierarchyNodeRef>(`/nodes/${nodeId}`, signal);
  }

  async getChildren(nodeId: string): Promise<HierarchyNodeRef[]> {
    return this.getJson<HierarchyNodeRef[]>(`/nodes/${nodeId}/children`);
  }

  async getConnections(nodeId: string): Promise<Connection[]> {
    return this.getJson<Connection[]>(`/nodes/${nodeId}/connections`);
  }

  async getRoute(fromId: string, toId: string): Promise<string[] | null> {
    const query = `from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`;
    const body = await this.getJson<{ path: string[] | null }>(`/route?${query}`);
    return body.path;
  }

  async getDiff(signal?: AbortSignal): Promise<FunctionDiff[]> {
    return this.getJson<FunctionDiff[]>("/diff", signal);
  }

  async getChangeCards(signal?: AbortSignal): Promise<ChangeCardSet> {
    return this.getJson<ChangeCardSet>("/change-cards", signal);
  }

  async acceptDiff(nodeId: string): Promise<void> {
    await this.postJson<unknown>(`/diff/${nodeId}/accept`);
  }

  async getSidecar<K extends SidecarKind>(kind: K): Promise<SidecarPayload[K]> {
    // "coverage" now rides the unified context envelope (037, T050/T051) -- unwrap its one field.
    if (kind === "coverage") {
      const envelope = await this.getJson<{ coverage: C1Coverage }>(SIDECAR_ROUTES[kind]);
      return envelope.coverage as SidecarPayload[K];
    }
    return this.getJson<SidecarPayload[K]>(SIDECAR_ROUTES[kind]);
  }

  subscribeSidecar(kind: SidecarKind, onChange: () => void): () => void {
    return this.on(SIDECAR_TOPICS[kind], onChange);
  }

  async listTraces(): Promise<TraceSummary[]> {
    return this.getJson<TraceSummary[]>("/traces");
  }

  async getTrace(traceId: string): Promise<Trace> {
    return this.getJson<Trace>(`/traces/${traceId}`);
  }

  subscribe(onChange: () => void): () => void {
    return this.on("changed", onChange);
  }

  subscribeTrace(onChange: () => void): () => void {
    return this.on("trace", onChange);
  }

  subscribeAgents(onEvent: (message: AgentEvent) => void): () => void {
    const unsubscribes = AGENT_EVENT_TYPES.map((type) => this.on<AgentEvent>(type, onEvent));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }

  async getEpicsItem(itemId: string, expand?: string): Promise<EpicWorkItem> {
    const query = expand ? `?expand=${encodeURIComponent(expand)}` : "";
    return this.getJson<EpicWorkItem>(`/epics/items/${encodeURIComponent(itemId)}${query}`);
  }

  async getSourceFragment(
    path: string,
    range?: { start?: number; end?: number },
  ): Promise<SourceFragment> {
    const params = new URLSearchParams({ path });
    if (range?.start != null) params.set("start", String(range.start));
    if (range?.end != null) params.set("end", String(range.end));
    return this.getJson<SourceFragment>(`/source?${params}`);
  }

  generateEpicBrief(itemId: string, force?: boolean): Promise<EpicBriefJobState> {
    const forceQuery = force ? "?force=true" : "";
    return this.postJson<EpicBriefJobState>(
      `/epics/${encodeURIComponent(itemId)}/brief${forceQuery}`,
    );
  }

  getEpicBrief(itemId: string): Promise<EpicBriefJobState> {
    return this.getJson<EpicBriefJobState>(`/epics/${encodeURIComponent(itemId)}/brief`);
  }

  async getEpicBriefOutput(itemId: string): Promise<string[]> {
    const body = await this.getJson<{ lines: string[] }>(
      `/epics/${encodeURIComponent(itemId)}/brief/output`,
    );
    return body.lines;
  }

  cancelEpicBrief(itemId: string): Promise<EpicBriefJobState> {
    return this.postJson<EpicBriefJobState>(
      `/epics/${encodeURIComponent(itemId)}/brief/cancel`,
    );
  }

  listDiagramTypes(): Promise<DiagramTypeSummary[]> {
    return this.libraryRequest<{ types: DiagramTypeSummary[] }>("/diagram-types").then(
      (body) => body.types,
    );
  }

  subscribeTraceStream(onEvent: (message: TraceStreamMessage) => void): () => void {
    this.traceStreamListeners.add(onEvent);
    this.ensureTraceStreamSocket();
    return () => {
      this.traceStreamListeners.delete(onEvent);
      if (this.traceStreamListeners.size > 0) return;
      if (this.traceReconnectTimer) {
        clearTimeout(this.traceReconnectTimer);
        this.traceReconnectTimer = null;
      }
      if (this.traceStreamSocket) {
        this.traceStreamSocket.close();
        this.traceStreamSocket = null;
      }
    };
  }

  private wsUrl(path: string): string {
    return `${this.baseUrl.replace(/^http/, "ws")}/repos/${this.repoId}${path}`;
  }

  private ensureSocket(): void {
    if (this.socket || typeof WebSocket === "undefined") return;
    const socket = new WebSocket(this.wsUrl("/events"));
    this.socket = socket;
    socket.onopen = () => {
      // Read by scheduleReconnect to judge whether this connection lasted long enough to count.
      this.socketOpenedAt = Date.now();
      // A reopen after a drop: re-fetch everything, since pings during the gap are gone forever.
      if (this.everConnected) this.notifyResync();
      this.everConnected = true;
    };
    socket.onmessage = (event) => {
      const message = this.parseMessage(event.data);
      if (!message?.type || this.isForAnotherWorkspace(message)) return;
      const set = this.listeners.get(message.type as EventType);
      // The status, output and agent kinds carry a payload; the rest are bare "go re-fetch" pings
      // whose listeners ignore the message they're handed.
      set?.forEach((listener) => (listener as (payload: unknown) => void)(message));
    };
    socket.onclose = () => {
      this.socket = null;
      this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  /** Nudges every bare-ping listener set once so its hook re-fetches. Status/output/agent
   * listeners expect a payload the client can't synthesize, so they are skipped — their next
   * real event carries full state anyway. */
  private notifyResync(): void {
    for (const [type, set] of this.listeners) {
      if (type.endsWith("-status") || type.endsWith("-output")) continue;
      if ((AGENT_EVENT_TYPES as readonly string[]).includes(type)) continue;
      set.forEach((listener) => (listener as () => void)());
    }
  }

  /** Releases the sockets, timers and listeners this client owns. Safe to call twice, and not
   * terminal: a later subscribe lazily reopens (StrictMode's double-mount relies on this). */
  dispose(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.traceReconnectTimer) {
      clearTimeout(this.traceReconnectTimer);
      this.traceReconnectTimer = null;
    }
    this.listeners.clear();
    this.traceStreamListeners.clear();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    const traceSocket = this.traceStreamSocket;
    this.traceStreamSocket = null;
    traceSocket?.close();
  }

  private ensureTraceStreamSocket(): void {
    if (this.traceStreamSocket || typeof WebSocket === "undefined") return;
    const socket = new WebSocket(this.wsUrl("/trace-stream"));
    this.traceStreamSocket = socket;
    socket.onmessage = (event) => {
      let message: TraceStreamMessage | null = null;
      try {
        message = JSON.parse(String(event.data)) as TraceStreamMessage;
      } catch {
        return;
      }
      if (message) this.traceStreamListeners.forEach((listener) => listener(message));
    };
    socket.onclose = () => {
      this.traceStreamSocket = null;
      // The timer is held and re-checked on fire, so an unsubscribe inside the 1s window can
      // cancel it instead of resurrecting a socket nobody listens to.
      if (this.traceStreamListeners.size > 0 && !this.traceReconnectTimer) {
        this.traceReconnectTimer = setTimeout(() => {
          this.traceReconnectTimer = null;
          if (this.traceStreamListeners.size > 0) this.ensureTraceStreamSocket();
        }, 1000);
      }
    };
    socket.onerror = () => socket.close();
  }

  /** A ping for a workspace this client isn't drawing — an agent's edits must not refetch the
   * user's own view, and vice versa. Main's pings carry no key at all, so absent means "main". */
  private isForAnotherWorkspace(message: { type?: string } & Record<string, unknown>): boolean {
    // Agent lifecycle pings are global by nature: the list spans every workspace.
    if ((AGENT_EVENT_TYPES as readonly string[]).includes(message.type ?? "")) return false;
    const workspace = typeof message.workspace === "string" ? message.workspace : MAIN_WORKSPACE;
    return workspace !== this.repoId;
  }

  private parseMessage(raw: unknown): ({ type?: string } & Record<string, unknown>) | undefined {
    try {
      return JSON.parse(String(raw)) as { type?: string } & Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private scheduleReconnect(): void {
    const hasListeners = [...this.listeners.values()].some((set) => set.size > 0);
    if (this.reconnectTimer || !hasListeners) return;
    const stable =
      this.socketOpenedAt !== 0 && Date.now() - this.socketOpenedAt >= RECONNECT_STABLE_MS;
    if (stable) this.reconnectDelayMs = RECONNECT_BASE_MS;
    this.socketOpenedAt = 0;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket();
    }, delay);
  }
}
