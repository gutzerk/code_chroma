export type HierarchyLevel = "folder" | "file" | "class" | "function" | "code";

/** Architectural role a C1 diagram box/sub-block can be authored or inferred as — drives which
 * glyph C1BlockIcon renders. "system"/"person"/"external_system" are the three top-level box kinds
 * (system is implicit, the actor kinds mirror C1Actor.type); the rest are optional per-sub-block
 * kinds the codechroma-draw-diagram skill (c1 type) may set on a C1Child to make a deep diagram
 * scannable at a glance. */
export type C1BlockKind =
  | "system"
  | "person"
  | "external_system"
  | "api"
  | "ui"
  | "service"
  | "database"
  | "queue"
  | "cache"
  | "worker"
  | "auth";

/**
 * Client-side cache of one structure-mode hierarchy node, fetched lazily per block via the
 * bridge (contracts/canvas-bridge-api.md). Never mutated locally.
 */
export interface HierarchyNodeRef {
  node_id: string;
  name: string;
  level: HierarchyLevel;
  /** Single parent — structure mode is inherently single-parent; null only for a repository root. */
  parent_id: string | null;
  has_children: boolean;
  child_count: number;
  /** Display signature, e.g. "(user_id: str, amount: float) -> float" — set for class/function nodes. */
  params?: string;
  /** Code shown in CodePopup/CodeView — a snippet for function-level nodes, or the whole file's
   * text for file-level nodes with descendant source. */
  source?: string;
  /** Language of `source`, e.g. "python" — selects the CodeView syntax highlighter. */
  language?: string;
  /** Folder nodes only: true iff its whole subtree is documentation files (.md/.rst/.txt/.adoc) —
   * renders grey. Absent/false for every other node. */
  doc_only?: boolean;
  /** Short summary shown only while expanded — set client-side by the C1 view; the bridge never sends it. */
  description?: string;
  /** C1 sub-blocks only: true when the authored path matched no graph node, so it drills nowhere. */
  unresolved?: boolean;
  /** C1 nodes only: architectural role, set client-side from C1Actor.type / C1Child.kind — the
   * bridge never sends it. Selects C1BlockIcon's glyph instead of the generic NodeKindIcon. */
  kind?: C1BlockKind;
  /** C1 nodes only: a simple-icons slug (e.g. "stripe") set client-side from C1Actor.icon /
   * C1Child.icon. Wins over `kind` when the slug is recognized (BrandIcon renders the real logo);
   * an unrecognized slug falls back to `kind`/`level` exactly as if unset. */
  icon?: string;
}

/** A single reference/call edge between two nodes — mirrors GraphEngine's depends_on_ids
 * (src/codechroma/engine.py get_dependencies/get_dependents), not necessarily parent/child. */
export interface Connection {
  from_id: string;
  to_id: string;
}

/** The shape a card resolved server-side to the nearest existing node attaches with — `node_id` is
 * always present (the repo root at worst), so unlike a deleted FunctionDiff a card never floats
 * free of a block. `resolution` records how deep it landed vs the intended target: "exact" (that
 * symbol), "parent" (its file/class — the symbol will be added), "ancestor" (a directory — the file
 * will be created). Kept as the base shape ChangeCard extends, even though the plan overlay that
 * originally produced it (`.codechroma/plan.json`, the `codechroma-plan` skill) has been retired. */
export interface PlanStep {
  id: string;
  /** One-line preview shown on the step card; the always-visible label. */
  text: string;
  /** Full description revealed when the card is clicked open — empty/absent cards can't expand. */
  details?: string;
  node_id: string;
  /** "delete" marks a file/symbol to be removed (renders red); it can't be inferred from resolution
   * (a still-present symbol resolves to exact/modify), so a plan must set it explicitly. */
  kind?: "modify" | "add" | "create" | "delete";
  resolution?: "exact" | "parent" | "ancestor";
}

/** One deterministic change vs the workspace's diff base, pinned to the nearest existing block.
 *
 * Extends PlanStep because the wire shape is deliberately plan-step-shaped: one CardPanel renders
 * both layers, so `text`/`node_id`/`kind`/`resolution` have to mean the same thing in each. A change
 * card is not a plan step semantically — it says what *did* happen, not what should — but the extra
 * fields below are what the panel shows as its always-visible meta line. */
export interface ChangeCard extends PlanStep {
  /** No "create": git only ever reports added/modified/deleted. */
  kind: "modify" | "add" | "delete";
  /** Repo-root-relative path the change is in. */
  file: string;
  /** The symbol that changed, or null for a whole-file change. */
  symbol: string | null;
  /** Bare symbol/file name, without its class prefix. */
  name: string;
  /** What kind of thing changed — the graph level, not the plan `kind`. */
  target: "function" | "class" | "file";
  /** git's own word for the change. */
  status: "added" | "modified" | "deleted";
  added_lines: number;
  removed_lines: number;
  /** True when the content isn't decodable text, so the line counts are 0 rather than unknown. */
  binary: boolean;
}

/** GET /repos/{id}/change-cards. `base_resolved` is load-bearing: an unreachable base makes git
 * report no changes at all, which would otherwise render as an honest-looking empty change set.
 * `unassigned` names changes that got no card rather than dropping them. */
export interface ChangeCardSet {
  base: string;
  base_resolved: boolean;
  card_count: number;
  cards: ChangeCard[];
  /** node_id -> how many cards it carries; several cards on one block is the normal case. */
  by_node: Record<string, number>;
  /** node_id -> added/modified/removed, the plain hierarchy view's block-recolor signal. */
  by_node_status: Record<string, string>;
  unassigned: { path: string; status: string; reason: string }[];
}

/** An exception observed during a traced run, tagged with whether it was caught upstack. */
export interface TraceError {
  type: string;
  message: string;
  handled: boolean;
}

/** One recorded runtime event (GET /repos/{id}/traces/{id}), mapped to the function node it ran.
 * Wire-format snake_case, same as PlanStep — `node_id` is null for a frame that couldn't be mapped
 * to a graph node. `error` is set on "raise"/"unwind" steps; the trace's culprit is the last
 * unhandled raise. */
export interface TraceFrame {
  seq: number;
  node_id: string | null;
  event: "call" | "return" | "raise" | "unwind";
  depth: number;
  caller_node_id?: string | null;
  ts_ms?: number;
  dur_ms?: number | null;
  args?: string | null;
  error?: TraceError | null;
}

/** A recorded trace's summary for the canvas's trace picker (GET /repos/{id}/traces). */
export interface TraceSummary {
  id: string;
  entry: string;
  created_at: string;
  status: "ok" | "failed";
  step_count: number;
}

/** A full recorded trace: ordered steps plus entry/status metadata the canvas replays. */
export interface Trace {
  id: string;
  entry: string;
  created_at: string;
  status: "ok" | "failed";
  steps: TraceFrame[];
}

/** A live message on the trace-stream socket: a run beginning, a captured step, or a run ending. */
export type TraceStreamMessage =
  | { type: "trace-start"; trace_id: string; entry?: string }
  | { type: "step"; trace_id: string; step: TraceFrame }
  | { type: "trace-end"; trace_id: string; status: "ok" | "failed" };

/** One repo subtree no authored block covers, from c1_coverage's `uncovered_roots`.
 *
 * The diagram is curated, so blocks never cover everything — but before this, uncovered code was
 * unreachable rather than merely unnamed. The canvas hangs these off the system box as one
 * "Unmapped code" block, which is what makes "every file is somewhere on the diagram" true. */
export interface C1UnmappedEntry {
  node_id: string;
  path: string;
  name: string;
  level: "folder" | "file";
}

/** One node of the one shared diagram shape every kind (c1/patterns/impact/custom/<id>) now
 * authors and resolves to (036-shared-diagram-style-catalog) — see
 * `specs/036-shared-diagram-style-catalog/contracts/diagram-schema.md`. `node_id` is filled
 * server-side from `path` (null = no path, or a stale one — never a hard failure). `kind`/`icon`
 * pick the box's glyph (`nodeAccent.tsx`); type-specific fields (`status`, `confirmed`,
 * `confidence`, `role`, ...) live in `meta`, uninterpreted by any shared code on either side. */
export interface DiagramNode {
  id: string;
  name: string;
  description?: string;
  /** Another node's own id — decomposition/nesting (c1) or instance→participant grouping
   * (patterns). Never a display hierarchy of its own; `group` is the clustering signal for that. */
  parent?: string | null;
  path?: string | null;
  node_id: string | null;
  group?: string | null;
  kind?: C1BlockKind | string | null;
  icon?: string | null;
  /** Optional allow-listed inline style (color/border/background only); anything else is ignored. */
  style?: Record<string, string> | null;
  meta?: Record<string, unknown>;
  /** Impact only: true for a node the change/plan touches directly, false for a one-hop neighbour
   * pulled in around it — passed through verbatim by resolve_diagram, not folded into `meta`. */
  seed?: boolean;
}

/** One relation of the shared diagram shape — direction is who initiates. */
export interface DiagramRelation {
  from: string;
  to: string;
  kind?: string;
  label?: string;
  /** Type of call/transport between the two boxes (`call`, `https`, `mcp`, `rpc`, ...) — optional.
   * When set, the renderer shows it as a second line under the `label` divider. */
  transport?: string;
  /** Item override wins over the diagram's own resolved `edge_style`, else no style at all. */
  style?: Record<string, string> | null;
}

/** The one shared diagram payload (GET /repos/{id}/{c1,patterns,impact,custom/<id>}) — replaces
 * the old per-kind `C1Diagram`/`PatternsDiagram`/`ImpactDiagram`/`CustomDiagram` families now that
 * every kind resolves through the one shared `resolve_diagram()` (bridge/diagram_resolver.py).
 * Every field below is optional except `nodes`/`relations`, since which of the rest apply is a
 * per-kind convention, not a shared contract: `groups`/`unmapped` from opt-in add-ons, `stale`/
 * `fingerprint`/`reviewed_fingerprint` from patterns/impact/custom's staleness, `source`/`feature`/
 * `seed_count`/`node_count`/`truncated` from impact's own slice metadata. */
export interface Diagram {
  type?: string;
  style?: string | Record<string, unknown>;
  nodes: DiagramNode[];
  relations: DiagramRelation[];
  groups?: string[];
  unmapped?: C1UnmappedEntry[];
  has_diagram?: boolean;
  generated_at?: string | null;
  fingerprint?: string;
  reviewed_fingerprint?: string | null;
  stale?: boolean;
  source?: "diff" | "plan";
  feature?: string | null;
  seed_count?: number;
  node_count?: number;
  truncated?: boolean;
  diagnostics?: DiagramDiagnostics;
  /** True when the saved file predates 036's shared shape and couldn't auto-convert -- the person
   * should regenerate it (see legacy-migration.md); the bridge never crashes on it either way. */
  needs_regeneration?: boolean;
}

/** The shared "nothing generated yet" Diagram — one literal instead of a copy per caller. */
export const EMPTY_DIAGRAM: Diagram = {
  nodes: [],
  relations: [],
  groups: [],
  has_diagram: false,
  stale: false,
};

/** The C1 diagram's repo coverage in files, from the `.coverage` field of GET /repos/{id}/c1/context.
 *
 * `has_diagram` is not redundant with a 0% reading: with no c1.json at all the bridge honestly
 * reports every file as unmapped, and "you haven't drawn one yet" must not render as "your diagram
 * misses everything". Dot-directories are scored out of every count here (but not out of the
 * canvas's `unmapped` list) — see c1_coverage's module docstring. */
export interface C1Coverage {
  has_diagram: boolean;
  total_files: number;
  covered_files: number;
  unmapped_files: number;
  percent: number;
  entries: (C1UnmappedEntry & { file_count: number })[];
  truncated: boolean;
}

/** A diagram type the bridge serves under one route shape (GET/POST /repos/{id}/<kind>/...).
 * `` `custom/${typeId}` `` is a whole family, not one member — feature 011's user-defined types are
 * data, not code, so a new one needs no new union member, only a new `.codechroma/diagram-types/*`
 * file. */
export type DiagramKind = "c1" | "patterns" | "impact" | "sequence" | `custom/${string}`;

/** Every kind `getDiagram(kind)` can fetch: every DiagramKind, plus "epics" — its index shares the
 * same GET /repos/{id}/{kind} shape but is assembled from the requirements source, never
 * AI-generated, so it has no generate/status/output trio. */
export type DiagramFetchKind = DiagramKind | "epics";

/** Every kind with a saved-layout GET/POST pair. As of 016-single-canvas-dashboard Stage 6 only
 * "hierarchy" has a live backend route left — every DiagramKind's and "epics"'s own layout pair was
 * deleted, since a canvas box's position lives on canvas.json now (see single-canvas.md). The type
 * stays this wide (not narrowed to "hierarchy") because `undoStore`/`UndoManager` are shared,
 * kind-parametrized infrastructure with no other reason to be hierarchy-only. "canvas" is the one
 * canvas document's own undo scope (a `CanvasNodeBox` drag) -- distinct from "hierarchy" because
 * both kinds of box are on screen at once now; `UndoManager.undoLatest` picks between them by
 * recency so one Ctrl+Z undoes whichever was actually touched last. */
export type LayoutKind = DiagramKind | "hierarchy" | "epics" | "impact" | "canvas";

/** A diagram's saved box positions: drag offset from the dagre-computed position, keyed by box id
 * ("system"/an actor id for C1, PatternNodeLayout.id for Patterns, a hierarchy node id for
 * "hierarchy"). Persisted per kind to .codechroma/<kind>-layout.json. */
export type DiagramLayout = Record<string, { x: number; y: number }>;

/** Status of the background `claude -p` job generating a diagram (GET/POST /repos/{id}/<kind>/...). */
export interface DiagramGenerationStatus {
  state: "idle" | "generating" | "error";
  error?: string | null;
}

/** Options for POST /repos/{id}/<kind>/generate. `onlyIfMissing` asks the bridge to refuse the run
 * when a valid artifact already exists — set by the canvas's automatic trigger, never by the user's
 * own Retry, which must still work on a file the bridge calls valid but that renders empty.
 * `updateInstructions` is the user's free-text note (e.g. what changed in the codebase) that a
 * manual regeneration should fold into the skill prompt. */
export interface DiagramGenerationOptions {
  onlyIfMissing?: boolean;
  updateInstructions?: string;
  /** The Impact skill's seed source — "diff" (git diff) or "plan" (spec). Ignored by other kinds. */
  source?: "diff" | "plan";
  /** The feature directory whose spec files seed the Impact "plan" slice (e.g. specs/006-…).
   * Passed only for impact with source "plan". Ignored by other kinds. */
  feature?: string;
}

/** GET /repos/{id}/wiki-general/status: the background job's state plus whether a valid
 * .codechroma/wiki-general/ already exists on disk -- not folded into DiagramGenerationStatus
 * itself since no other kind carries this extra field (see docs/architecture/wiki-general.md). */
export interface WikiGeneralStatus extends DiagramGenerationStatus {
  has_wiki_general: boolean;
  /** True once a commit lands past the commit this tree was last built/patched from. */
  stale: boolean;
  /** True if the repo has no real code to document yet (only doc/config files, or none at all). */
  empty: boolean;
}

/** GET /repos/{id}/diagrams/status's whole payload: one entry per registered diagram kind (built-in
 * or `custom/<id>`) saying whether its artifact already exists on disk, so the "Add diagram" menu
 * never offers a click that silently no-ops. Keyed by the same name the canvas uses for that
 * diagram's layer, so a new kind needs no change on this side. */
export type DiagramsStatus = Record<string, { ready: boolean; fingerprint?: string | null }>;

/** How an Impact box changed vs git HEAD — "removed" covers both a deleted path and an
 * agent-declared removal, so it can't be derived from the file statuses alone. */
export type ImpactChangeStatus = "added" | "modified" | "removed";

/** One changed file attributed to an Impact box by its real graph `node_id` (an exact match, or the
 * nearest real ancestor the box collapsed several changed symbols into). */
export interface ImpactChangedFile {
  path: string;
  status: ImpactChangeStatus | "deleted";
}

/** One GitHub PR comment — inline (tied to a diff line, `path`/`line` set) or general/issue-level
 * (`path`/`line` null), attributed to a box by the same node_id/ancestor rule as files, or
 * surfaced in the summary panel when it names no path a box covers. */
export interface PrReviewComment {
  author: string;
  body: string;
  created_at: string;
  path: string | null;
  line: number | null;
  /** The function/class the line resolves inside, via the graph's own symbol ranges — no LLM. */
  symbol?: string | null;
  /** Node id to open in the inspector for `symbol`; absent when the line matched no known symbol. */
  node_id?: string | null;
}

/** One Impact diagram box the current git diff touches (GET /repos/{id}/impact-changes). `node_id`
 * is the canvas id of the box it annotates, so the store can key on it directly. `change_count` is
 * how many attributed changes landed on this box; `files` are those attributions. The prose fields
 * are empty until the codechroma-review-diagram skill has written a review. */
export interface ImpactBlockChange {
  /** The impact box's own id (impact.json's `nodes[].id`) — the review's address. */
  block: string;
  node_id: string;
  name: string;
  path: string | null;
  status: ImpactChangeStatus;
  files: ImpactChangedFile[];
  change_count: number;
  before: string;
  after: string;
  explanation: string;
  pr_comments: PrReviewComment[];
}

/** A box the change removed: it no longer exists in impact.json, so only the review can name it,
 * and the canvas renders it as a greyed-out extra child of `parent_node_id`. */
export interface ImpactGhostBlock {
  id: string;
  node_id: string;
  parent: string;
  parent_node_id: string;
  name: string;
  status: "removed";
  before: string;
  after: string;
  explanation: string;
}

/** A relationship arrow the change adds or removes; both endpoints are known boxes on the current
 * diagram (the bridge drops any that aren't, since there'd be nothing to attach the arrow to). */
export interface ImpactRelationshipChange {
  from: string;
  to: string;
  label: string;
  status: ImpactChangeStatus;
  explanation: string;
  /** Resolved onto the same flat node ids the diagram itself uses (036-shared-diagram-style-
   * catalog) — the review may spell an endpoint differently from impact.json and still land. */
  from_node_id?: string | null;
  to_node_id?: string | null;
}

/** The whole change review (GET /repos/{id}/impact-changes): git's deterministic box mapping
 * merged with the agent's written `.codechroma/impact-changes.json`. `has_review`/`stale` drive
 * whether the canvas triggers a fresh `claude -p` run — a review whose `fingerprint` no longer
 * matches the working tree is reviewing a diff that's gone. */
export interface ImpactChanges {
  fingerprint: string;
  reviewed_fingerprint: string | null;
  has_review: boolean;
  stale: boolean;
  summary: string;
  blocks: ImpactBlockChange[];
  ghosts: ImpactGhostBlock[];
  relationships: ImpactRelationshipChange[];
  /** Changed files no box on the diagram covers — surfaced rather than implying full coverage. */
  unassigned: ImpactChangedFile[];
  changed_file_count: number;
  /** PR comments with no path, or whose path no box covers — general PR discussion. */
  general_pr_comments: PrReviewComment[];
}

/** The shape GET /impact-changes returns for a clean tree — shared by the stub client and the
 * sidecar store's initial snapshot, so "no changes" is defined once. */
export const EMPTY_IMPACT_CHANGES: ImpactChanges = {
  fingerprint: "",
  reviewed_fingerprint: null,
  has_review: false,
  stale: false,
  summary: "",
  blocks: [],
  ghosts: [],
  relationships: [],
  unassigned: [],
  changed_file_count: 0,
  general_pr_comments: [],
};

/** Which assistant the app runs (skill-agent diagram gen, parallel-agent windows) — GET
 * /assistant/settings returns this masked shape; PUT accepts a saveable superset. */
export interface AssistantSettings {
  cli: string;
  /** Selected model; null/unset means "use each generator's built-in default". */
  model: string | null;
  /** True when a raw key is stored (the key itself is never sent back to the UI). */
  api_key_set: boolean;
  /** A credentials file path, when the user chose file-based creds. */
  api_key_path: string | null;
  schema_version?: number;
}

export type ExpandState = "collapsed" | "expanded";

/** A function whose current on-disk source differs from its git-HEAD source (GET
 * /repos/{id}/diff) — orthogonal to BlockView's expand/collapse lifecycle, so it's tracked in its
 * own store (diffOverlayStore.ts) rather than as a BlockView field. */
export interface FunctionDiff {
  node_id: string;
  original_source: string;
  proposed_source: string;
  /** How the function changed vs git HEAD — "deleted" entries have no live node and render as
   * floating blurred panels; "added"/"modified" attach to their live block. Absent on the mock. */
  status?: "added" | "modified" | "deleted";
  /** Display name, used to label a "deleted" panel that has no live node to read a name from. */
  name?: string;
  /** Hierarchy level of the diffed node. Container levels (folder/file/class) are expanded on
   * reveal rather than opened as a code panel; absent/"function" keeps the original behavior. */
  level?: HierarchyLevel;
}

/**
 * The on-canvas render state of one HierarchyNodeRef — expansion state lives here, not on the
 * node itself, since the same node's data never changes while its view does.
 */
export interface BlockView {
  node_id: string;
  expand_state: ExpandState;
  /** Whether this node's inline code view (function source, or whole-file source) is showing —
   * only meaningful in "inline" code-view mode; toggled by its block's code button, never by
   * clicking the block body. */
  code_visible: boolean;
}

/** Screen-space geometry of one agent window — screen coordinates, not canvas ones, so a window
 * never scales with canvas zoom. Persisted per agent in `.codechroma/agents.json`. */
export interface AgentWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  z: number;
}

/** What the LED shows. `stopped`/`exited` come from the process itself; `idle`/`blocked`/`working`
 * are inferred from the live PTY screen by the bridge's detector, and `foreign` means the terminal
 * is running something else (vim, a nested shell), so the last known colour is held. */
export type AgentStatus =
  "stopped" | "running" | "exited" | "idle" | "blocked" | "working" | "foreign";

/** One parallel agent session: its own branch, its own git worktree, its own window (GET /agents). */
export interface AgentRecord {
  id: string;
  title: string;
  kind: string;
  branch: string;
  /** Which of main's branches this agent belongs to. Null for a record written before the field, and
   * ⚠ *absent entirely* from a bridge older than it — `branchScope.baseBranchOf` folds both into null,
   * because either one hiding a live agent is the one outcome that must never happen. */
  base_branch?: string | null;
  /** The `pr-<n>` this agent was forked from, if any; hides `Create PR` since that PR already exists. */
  source_pr?: string | null;
  /** The id this agent's worktree/branch is shared with (an "Add agent here" agent); null/absent
   * means its own worktree. Restoring its window must not re-activate a workspace the canvas is
   * already drawing. */
  shares_workspace_with?: string | null;
  worktree: string;
  created_at: string;
  /** Set once a conversation exists; null disables Resume rather than starting a fresh chat. */
  session_id: string | null;
  pr_url: string | null;
  pid: number | null;
  window: AgentWindowGeometry;
  status: AgentStatus;
  /** Non-zero means the agent crashed — rendered red, distinct from a deliberate stop. */
  exit_code: number | null;
  /** The worktree directory is gone (deleted by hand); the card offers to recreate it. */
  worktree_lost: boolean;
  /** `"task"` for an actionable first message (a "Draw a diagram" launch), `"view"` for the plain
   * acknowledge-only line. Survives `consume_context`, which clears `context` but not this, so it
   * still identifies a task agent once it goes idle. Absent from a bridge older than the field. */
  context_kind?: string;
  /** The binary/adapter a provider-routed (`kind === "agent"`) window actually launched, e.g. a
   * claude proxy or codex path. Empty for a legacy/`claude` record, whose label is its fixed kind. */
  resolved_cli?: string;
}

/** GET /agents — the cards plus which workspace the canvas is drawing and the hard agent cap. */
export interface AgentList {
  agents: AgentRecord[];
  active_workspace: string;
  max_agents: number;
}

/** GET/POST /agents/branch, POST /agents/branch/update — current branch plus every local branch. */
export interface BranchInfo {
  current: string | null;
  branches: string[];
}

/** One path the first commit would swallow that the user should look at first (GET
 * /agents/git-preflight). `preticked` means it is excluded by default; `already_ignored` means the
 * effective `.gitignore` covers it anyway, so ticking it changes nothing. */
export interface SuspiciousPath {
  path: string;
  reason: string;
  size: number;
  preticked: boolean;
  already_ignored: boolean;
}

/** What `git init` + the first commit would produce, in its default (everything pre-ticked) state. */
export interface CommitPlan {
  file_count: number;
  total_bytes: number;
  suspicious: SuspiciousPath[];
}

/** Whether agents can run here, and if not, what it would take (GET /agents/git-preflight). */
export interface GitPreflight {
  state: "ready" | "no-git" | "not-a-repo" | "no-commits" | "nested";
  root: string;
  /** Set only for `nested`: the repository this project sits inside, which it should be opened as. */
  parent_repo?: string;
  /** Absent for `ready`, `no-git` and `nested` — the three states with nothing to initialize. */
  plan?: CommitPlan;
}

/** POST /agents/git-init — what initialization actually did, so the UI can report it honestly. */
export interface GitInitResult {
  state: string;
  created_repo: boolean;
  created_gitignore: boolean;
  commit?: string | null;
}

/** A lifecycle ping on the shared events socket. `agent-status` is the LED's only input; the bridge
 * sends one per real change, never per screen repaint. */
export type AgentEvent =
  | { type: "agent-added"; agent: AgentRecord }
  | { type: "agent-removed"; id: string }
  | { type: "agent-status"; id: string; status: AgentStatus }
  | { type: "workspace-activated"; id: string }
  | { type: "branch-changed"; branch: string };

/** How far a workspace's graph is from being drawable (GET /workspaces/{id}/status). A worktree is
 * brought up lazily on first activation, and `analyzing` renders a real indicator — never an empty
 * canvas, which reads as a hang. */
export interface WorkspaceStatus {
  id: string;
  state: "analyzing" | "ready" | "error";
  progress: string;
  error: string | null;
  /** Writes are refused here: no Accept button, and no `claude -p` run. Absent means writable, so an
   * older bridge keeps today's behaviour for main and for every agent worktree. */
  read_only?: boolean;
}

/** One fetched pull request, drawn as a read-only workspace (GET /prs). `id` is `pr-<number>`, the
 * `repo_id` every canvas request for it uses. */
export interface PrWorkspace {
  id: string;
  number: number;
  title: string;
  url: string;
  author: string;
  state: string;
  head_ref: string;
  head_sha: string;
  head_repo: string;
  is_fork: boolean;
  base_ref: string;
  worktree: string;
  imported_at: string;
  fetched_at: string;
  changed_files: number;
  additions: number;
  deletions: number;
  /** Its directory is gone — deleted by hand, or by `git clean -xdf` in the main repository. */
  worktree_lost: boolean;
}

export interface PrWorkspaceList {
  prs: PrWorkspace[];
  max_prs: number;
  active_workspace: string;
}

/** One open pull request on GitHub itself (GET /prs/github) — not yet necessarily imported. */
export interface GithubOpenPr {
  number: number;
  title: string;
  head_ref: string;
  author: string;
}

/** What stops a pull request being opened, checked before the button renders (GET /prs/preflight).
 * `text` is the label a disabled button shows — the reason is never a post-click surprise. */
export interface PrImportPreflight {
  ready: boolean;
  reason: string | null;
  text?: string | null;
  origin?: { owner: string; repo: string } | null;
  count?: number;
  max_prs?: number;
}

/** What stops a PR being created, checked before the button renders (GET /agents/{id}/pr-preflight).
 * `text` is the label a disabled button shows — the reason is never a post-click error. */
export interface PrPreflight {
  ready: boolean;
  reason: string | null;
  text?: string | null;
  pr_url?: string | null;
  /** Uncommitted paths a push would leave behind; the UI forces an explicit choice about them. */
  dirty: string[];
}

/** The cheap listing entry (GET /repos/{id}/epics) — never grows a requirements/children/stages
 * field; that absence is FR-007 (see data-model.md's ItemRef). */
export interface WorkItemSummary {
  id: string;
  title: string;
  status: string;
  kind: string;
  group: string | null;
}

/** GET /repos/{id}/epics — summaries only, plus the configured source and the truncation count. */
export interface EpicsIndex {
  source: string;
  groups: (string | null)[];
  items: WorkItemSummary[];
  omitted: number;
  generated_at: string;
}

/** One acceptance criterion. `done` null (no checkbox, e.g. a Given/When/Then scenario) and `done`
 * false are distinct states — the canvas renders them with different glyphs (data-model.md). */
export interface EpicRequirement {
  id: string;
  text: string;
  kind: "checklist" | "given-when-then" | "functional" | string;
  done: boolean | null;
  source_ref: string;
}

/** A reference an expanded item names, never resolved by loading its target (FR-011). `in_index`
 * is set server-side (EpicsAssembler, D-14): true means the id already has its own top-level box in
 * the index, so the canvas connects to that box rather than registering a stub for it. */
export interface EpicItemLink {
  id: string;
  title: string | null;
  relation: "depends_on" | "enables" | string;
  in_index: boolean;
}

/** One item inside a delivery artifact's section, populated only once that stage is expanded. A
 * `[P]`/`[US1]`-shaped marker still survives verbatim in `text`; `parallel`/`story` are the same
 * markers parsed into structured fields. */
export interface EpicStageItem {
  id: string;
  text: string;
  done: boolean | null;
  story: string | null;
  parallel: boolean;
}

/** One phase/heading inside a delivery artifact. `done`/`total` are null unless every item in this
 * section carries a checkbox (data-model.md's StageSection). */
export interface EpicStageSection {
  title: string;
  items: EpicStageItem[];
  done: number | null;
  total: number | null;
}

/** One delivery artifact block (spec/plan/tasks). `sections` stays [] until this exact stage's node
 * id is passed as the item route's `expand` query param (FR-010). */
export interface EpicStage {
  kind: "spec" | "plan" | "tasks" | string;
  name: string;
  status: string | null;
  done: number | null;
  total: number | null;
  sections: EpicStageSection[];
  source_ref: string;
}

/** One fully-loaded work item (GET /repos/{id}/epics/items/{id}) — recursive: `children` covers
 * epic->story and any deeper tiering a source uses, one tier populated per fetch (FR-023). */
export interface EpicWorkItem {
  id: string;
  title: string;
  status: string;
  kind: string;
  summary: string;
  group: string | null;
  priority: string | null;
  source_ref: string;
  url: string | null;
  requirements: EpicRequirement[];
  children: EpicWorkItem[];
  links: EpicItemLink[];
  stages: EpicStage[];
}

/** A slice of a workspace file, as served for an epics block's source link. */
export interface SourceFragment {
  path: string;
  content: string;
  language: string | null;
}

/** One task attached to a scope item (or to the epic-level "prep" bucket) — 008-epics-ai-brief. */
export interface BriefTask {
  id: string;
  text: string;
  parallel: boolean;
  /** Spoke/part this task belongs to (e.g. "application", "backend") — null when cross-cutting. */
  repo: string | null;
  /** Tasks-stage name (spek slug) the real task came from — keys the resolver's text splice,
   * since a task id is only unique within one spec. Null for drafted tasks. */
  stage: string | null;
  /** True when this task is about testing (write tests, unit/integration/e2e, coverage) — the
   * canvas pools these into a labeled "Testing" subgroup inside Scope. Null/omitted for feature
   * tasks. */
  is_test?: boolean;
}

/** One in- or out-of-scope item; tasks live here, never in a separate top-level "tasks" tier. */
export interface EpicScopeItem {
  id: string;
  title: string;
  description: string;
  in_scope: boolean;
  tasks: BriefTask[];
  tasks_source: "spec" | "draft" | null;
  out_of_scope_ref: string | null;
}

/** One checklist row; closes_scope_id: null renders the canvas's red "gap" badge. */
export interface EpicAcceptanceCriterion {
  id: string;
  text: string;
  done: boolean | null;
  closes_scope_id: string | null;
}

/** One depends_on/enables/risk/check line in the "Dependencies & risks" frame. */
export interface EpicDependency {
  kind: "depends_on" | "enables" | "risk" | "check";
  text: string;
  ids: string[];
}

/** One owning repo/area of a multi-repo epic — mirrors the LMP-123 spokes list entry. */
export interface EpicBriefSpoke {
  spoke: string;
  role: string;
}

/** The whole per-epic AI-brief artifact (GET .../epics/{id}/brief) — problem/value, scope (with
 * tasks attached to the scope item they implement), dependencies & risks, acceptance criteria. */
export interface EpicBrief {
  epic_id: string;
  generated_at: string;
  problem: string[];
  component: string | null;
  spokes: EpicBriefSpoke[];
  scope: EpicScopeItem[];
  prep_tasks: BriefTask[];
  dependencies: EpicDependency[];
  acceptance: EpicAcceptanceCriterion[];
}

/** GET/POST /repos/{id}/epics/{item_id}/brief — one epic's brief job state plus its brief once
 * done. There is no inline/degraded path, so "done" never occurs here. */
export interface EpicBriefJobState {
  job_key: string;
  state: "idle" | "generating" | "error";
  error: string | null;
  brief: EpicBrief | null;
}

// --- User-defined custom diagrams (feature 011) ---
// Two layers, deliberately never merged into one type: a *definition* (cross-project, authored by
// hand or by a direct API/skill call -- the interview wizard that used to author these is retired --
// `~/.codechroma/diagram-types/<id>.json`) that says WHAT to draw and HOW, and a *diagram* (per-repo,
// `<repo>/.codechroma/custom/<id>.json`) that is the AI-generated result for one repo. GET
// /diagram-styles serves the render style registry, but no TS caller consumes it (only the
// codechroma-draw-diagram skill script does), so it has no type here.

/** One relation kind a diagram type's author named (e.g. "writes to") — free-form, unlike
 * PatternRelationKind's fixed enum, since a custom type's vocabulary is whatever its author chose. */
export interface DiagramTypeRelationKind {
  id: string;
  label: string;
}

/** The cross-project diagram-type definition (GET/PUT /diagram-types/{id}) — the reuse contract:
 * `instructions` must name no repo-specific file/class/module, so the same type generates a fresh,
 * sensible diagram in a different repo with no re-describing. */
export interface DiagramTypeDefinition {
  schema_version: number;
  id: string;
  title: string;
  description: string;
  style: string;
  layout: { direction: "TB" | "LR" };
  grouping: { enabled: boolean; label: string };
  relation_kinds: DiagramTypeRelationKind[];
  instructions: string;
  context_sources: string[];
  created_at: string;
  updated_at: string;
}

/** The cheap listing entry (GET /diagram-types) — never carries the full definition (instructions,
 * layout, grouping), mirroring WorkItemSummary's "index vs full item" split. */
export interface DiagramTypeSummary {
  id: string;
  title: string;
  description: string;
  style: string;
}

/** A generated custom diagram (GET /repos/{id}/custom/{typeId}) is a `Diagram` (036-shared-
 * diagram-style-catalog) -- see `state/types.ts`'s `Diagram`/`DiagramNode`/`DiagramRelation`. The
 * in-app interview that used to author a new `DiagramTypeDefinition` (POST/GET
 * /diagram-types/interview...) is retired (diagram-management unification) -- a type is now saved
 * into the library by hand or by direct API/skill use only. */

/** GET /repos/{id}/impact is a `Diagram` (036-shared-diagram-style-catalog) -- see `Diagram`'s
 * `seed_count`/`node_count`/`truncated`/`source`/`feature` fields for impact's own slice metadata.
 * A node's plan role (`meta.status`: "new"/"modified"/"deleted"/"context") and `seed` live in
 * `meta`. */

// --- 016-single-canvas-dashboard: the one canvas document (GET/PATCH /repos/{id}/canvas) ---

/** What `elementRules.ts` (web/src/canvas/doc/) keys its per-kind CSS classes off. */
export type CanvasRenderKind =
  | "hierarchy"
  | "c1"
  | "pattern"
  | "impact"
  | "epic"
  | "spec"
  | "task"
  | "custom"
  | "group"
  | "note"
  | "sequence";

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface CanvasSize {
  w: number;
  h: number;
}

/** One box on the canvas — wire shape verbatim from `canvas/document.py`'s `Element`. */
export interface CanvasElement {
  id: string;
  render: CanvasRenderKind;
  layer: string;
  label: string;
  description: string;
  node_id: string | null;
  position: CanvasPosition;
  size: CanvasSize | null;
  group_id: string | null;
  meta: Record<string, unknown>;
  created_by: "ai" | "user";
  /** Optional allow-listed inline style (color/border/background only); see `authoredStyle.ts`. */
  style?: Record<string, string> | null;
}

/** One arrow between two elements — wire shape verbatim from `canvas/document.py`'s `Edge`. */
export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: string;
  layer: string;
  /** Type of call/transport (`call`, `https`, `mcp`, ...) — rendered as a second line under the
   * `label` divider; omitted renders single-line. */
  transport?: string;
  /** pr-lens-style emphasis, impact only: the 1-2 relations the drawing skill judged as best
   * explaining this PR, rendered bolder than the rest (see RelationshipEdge's `isHero`). */
  hero?: boolean;
  /** Optional allow-listed inline style (color/stroke only for an edge; see `authoredStyle.ts`). */
  style?: Record<string, string> | null;
  /** `file:line` of the edge's caller (provenance, resolver-stamped) — clicking the edge's label
   * opens that code location in the code sidebar. */
  origin?: string;
}

/** GET /repos/{id}/canvas's whole payload — `CanvasDoc.model_dump(by_alias=True)` verbatim. */
export interface CanvasDoc {
  schema_version: number;
  doc_id: string;
  updated_at: string;
  elements: Record<string, CanvasElement>;
  edges: Record<string, CanvasEdge>;
}

/** The shared "nothing on the canvas yet" CanvasDoc — one literal instead of a copy per caller.
 * Note this is emptier than anything the bridge actually serves: `canvas/document.py`'s
 * `ensure_seeded` guarantees a real document always carries the root block (see SEEDED_CANVAS_DOC),
 * so this stands only for "the fetch hasn't landed yet". */
export const EMPTY_CANVAS_DOC: CanvasDoc = {
  schema_version: 1,
  doc_id: "",
  updated_at: "",
  elements: {},
  edges: {},
};

/** The hierarchy root's node id, mirroring `bridge/plan_resolver.py`'s `ROOT_NODE_ID`.
 *
 * 🔴 The bridge *synthesizes* this node rather than storing it, so it's the one id that never comes
 * back from `getNode`/`getChildren` and has to be recognised by name instead — which is why three
 * unrelated places (the seeded document, `getCachedAncestorPath`'s completeness test, and
 * `RootCanvas`'s `?root=` default) each need it. One constant so they can't drift apart. */
export const ROOT_NODE_ID = "root";

/** The root block the bridge seeds every fresh document with (`canvas/document.py`'s
 * `hierarchy_seed`), mirrored here so the mock bridge and the stub client serve what the real one
 * does — a canvas with no hierarchy element renders nothing at all. */
export const SEEDED_CANVAS_DOC: CanvasDoc = {
  ...EMPTY_CANVAS_DOC,
  elements: {
    "seed-hierarchy": {
      id: "seed-hierarchy",
      render: "hierarchy",
      layer: "hierarchy",
      label: "",
      description: "",
      node_id: ROOT_NODE_ID,
      position: { x: 0, y: 0 },
      size: null,
      group_id: null,
      meta: {},
      created_by: "user",
    },
  },
};

/** One op inside a PATCH /repos/{id}/canvas batch — a loose bag of every op's optional fields,
 * mirroring `apply_batch.py`'s per-op handlers rather than a discriminated union, since the wire
 * shape is what the bridge already validates. */
export interface CanvasOp {
  op:
    | "add_element"
    | "add_group"
    | "add_note"
    | "add_edge"
    | "update_element"
    | "update_edge"
    | "delete_element"
    | "delete_edge";
  temp_id?: string;
  id?: string;
  render?: string;
  label?: string;
  description?: string;
  node_id?: string | null;
  position?: CanvasPosition;
  size?: CanvasSize | null;
  group_id?: string | null;
  meta?: Record<string, unknown>;
  created_by?: "ai" | "user";
  /** Allow-listed inline style (color/border/background only); `null` clears it on an update. */
  style?: Record<string, string> | null;
  from?: string;
  to?: string;
  kind?: string;
  layer?: string;
  /** pr-lens-style emphasis (Impact only) — see `CanvasEdge.hero`/`RelationshipEdge`'s `isHero`. */
  hero?: boolean;
  /** Call/transport token (`call`, `https`, `mcp`, ...) — see `CanvasEdge.transport`. */
  transport?: string;
}

export interface CanvasBatch {
  layer?: string;
  explanation?: string;
  ops: CanvasOp[];
  /** Bypasses the server's mass-delete guard for a deliberate bulk clear the caller has already
   * confirmed with the user -- no current caller sets this; never set for a chat-authored batch. */
  confirm_mass_delete?: boolean;
}

export interface CanvasOpError {
  op_index: number;
  code: string;
  message: string;
}

/** One node or arrow the pipeline could not draw. `reason` is a closed vocabulary the bridge owns
 * (`diagram_diagnostics.py`'s `REASONS`), so the label mapping lives on this side, not in prose. */
export interface DiagramDrop {
  what: string;
  id: string | null;
  reason: string;
  detail?: string;
}

/** What a diagram write lost between the skill's file and the canvas — soft by design: the diagram
 * still rendered. `dropped_count` is the true total, which `dropped` may have been capped below. */
export interface DiagramDiagnostics {
  dropped: DiagramDrop[];
  dropped_count: number;
  shown: number;
  truncated: boolean;
}

export type CanvasBatchResult =
  | {
      ok: true;
      batch_id: string;
      id_map: Record<string, string>;
      affected: string[];
      /** Only on a recipe run; a plain PATCH has no resolver stage to report drops from. */
      diagnostics?: DiagramDiagnostics;
    }
  | { ok: false; errors: CanvasOpError[] };

/** The `{"type": "canvas", ...}` WS push a successful PATCH fires directly (see routes/canvas.py) —
 * richer than the bare re-fetch ping every other diagram kind sends. */
export interface CanvasPing {
  type: "canvas";
  batch_id: string;
  affected: string[];
  new_elements: string[];
  workspace?: string;
}

