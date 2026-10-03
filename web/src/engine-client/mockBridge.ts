import {
  AGENT_EVENT_TYPES,
  type DiagramEventKind,
  type DiagramPayload,
  type DiagramPayloadFor,
  type EngineClient,
  type SidecarKind,
  type SidecarPayload,
  type SkillRunKind,
} from "./EngineClient";
import {
  SEEDED_CANVAS_DOC,
  EMPTY_DIAGRAM,
  type ImpactChanges,
  type CanvasBatch,
  type CanvasOp,
  type CanvasBatchResult,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasElement,
  type CanvasOpError,
  type CanvasPing,
  type ChangeCard,
  type ChangeCardSet,
  type Connection,
  type Diagram,
  type DiagramFetchKind,
  type DiagramGenerationOptions,
  type DiagramGenerationStatus,
  type DiagramLayout,
  type DiagramsStatus,
  type DiagramTypeDefinition,
  type DiagramTypeSummary,
  type EpicBrief,
  type EpicBriefJobState,
  type EpicsIndex,
  type EpicWorkItem,
  type FunctionDiff,
  type HierarchyNodeRef,
  type LayoutKind,
  type SourceFragment,
  type AgentEvent,
  type Trace,
  type TraceStreamMessage,
  type TraceSummary,
  type WikiGeneralStatus,
} from "../state/types";
import { FIXTURE_NODES, type FixtureNode } from "./fixtures";
import { FIXTURE_CONNECTIONS } from "./fixtureConnections";
import { STYLE_ALLOWED_KEYS } from "../canvas/authoredStyle";

/** Derived, not hardcoded, so regenerating the fixture can't leave the mock's coverage lying. */
const FIXTURE_FILE_COUNT = Object.keys(FIXTURE_NODES).filter((id) =>
  id.startsWith("file::"),
).length;

/** Canned "changed functions" for the mock Diff button — there's no real git repo backing the
 * fixtures, so this stands in for what a real GET /repos/{id}/diff would report. */
const MOCK_DIFF_TARGETS = ["function::calculate_total", "function::format_currency"];

/** A newly-created container (class) for the mock Diff button — stands in for what a real diff
 * reports when a file/class is added but has no indexed function children to reveal it. */
const MOCK_DIFF_ADDED_CONTAINER = "class::OrderRepository";

/** Canned change cards for the mock Diff button — the deterministic second layer of GET
 * /repos/{id}/change-cards. Deliberately covers the three shapes the panel renders differently: a
 * class whose diff panel the dedupe keeps (so the card is dropped downstream), a deleted symbol whose
 * node is gone and so resolves to its parent, and a non-code file pinned to its folder. */
const MOCK_CHANGE_CARDS: ChangeCard[] = [
  {
    id: "class::OrderRepository",
    text: "Added OrderRepository",
    details: "",
    node_id: "class::OrderRepository",
    kind: "add",
    resolution: "exact",
    file: "shadow-app/backend/repositories/order_repository.py",
    symbol: "OrderRepository",
    name: "OrderRepository",
    target: "class",
    status: "added",
    added_lines: 24,
    removed_lines: 0,
    binary: false,
  },
  {
    id: "shadow-app/backend/domain/order_service.py::function::legacy_total",
    text: "Deleted legacy_total",
    details: "",
    node_id: "file::shadow-app/backend/domain/order_service.py",
    kind: "delete",
    resolution: "parent",
    file: "shadow-app/backend/domain/order_service.py",
    symbol: "legacy_total",
    name: "legacy_total",
    target: "function",
    status: "deleted",
    added_lines: 0,
    removed_lines: 11,
    binary: false,
  },
  {
    id: "shadow-app/backend/routers/README.md",
    text: "Added README.md",
    details: "",
    node_id: "folder::shadow-app/backend/routers",
    kind: "add",
    resolution: "ancestor",
    file: "shadow-app/backend/routers/README.md",
    symbol: null,
    name: "README.md",
    target: "file",
    status: "added",
    added_lines: 6,
    removed_lines: 0,
    binary: false,
  },
  {
    id: "class::UserRepository",
    text: "Modified UserRepository",
    details: "",
    node_id: "class::UserRepository",
    kind: "modify",
    resolution: "exact",
    file: "shadow-app/backend/repositories/user_repository.py",
    symbol: "UserRepository",
    name: "UserRepository",
    target: "class",
    status: "modified",
    added_lines: 4,
    removed_lines: 1,
    binary: false,
  },
];

/** node_id -> added/modified/removed, mirroring change_cards.py's `_by_node_status` tie-break: a
 * node whose cards agree keeps that word, a mixed set collapses to modified. */
function byNodeStatus(cards: ChangeCard[]): Record<string, string> {
  const kindsByNode = new Map<string, Set<string>>();
  for (const card of cards) {
    const kinds = kindsByNode.get(card.node_id) ?? new Set<string>();
    kinds.add(card.status);
    kindsByNode.set(card.node_id, kinds);
  }
  const statuses: Record<string, string> = {};
  for (const [nodeId, kinds] of kindsByNode) {
    if (kinds.size === 1 && kinds.has("added")) statuses[nodeId] = "added";
    else if (kinds.size === 1 && kinds.has("deleted")) statuses[nodeId] = "removed";
    else statuses[nodeId] = "modified";
  }
  return statuses;
}

/** Canned execution traces for the mock Trace picker — stand in for real GET /repos/{id}/traces
 * output. Node ids exist in FIXTURE_NODES so the overlay resolves each frame to a fixture block. One
 * happy pipeline run and one failed run whose charge() raises. */
const MOCK_TRACES: Trace[] = [
  {
    id: "checkout-ok",
    entry: "create_order(cart)",
    created_at: "2026-07-20T10:00:00+00:00",
    status: "ok",
    steps: [
      { seq: 0, node_id: "function::create_order", event: "call", depth: 0, caller_node_id: null },
      {
        seq: 1,
        node_id: "function::apply_discount",
        event: "call",
        depth: 1,
        caller_node_id: "function::create_order",
      },
      {
        seq: 2,
        node_id: "function::calculate_total",
        event: "call",
        depth: 2,
        caller_node_id: "function::apply_discount",
      },
      { seq: 3, node_id: "function::calculate_total", event: "return", depth: 2, dur_ms: 0.4 },
      { seq: 4, node_id: "function::apply_discount", event: "return", depth: 1, dur_ms: 0.9 },
      {
        seq: 5,
        node_id: "function::format_currency",
        event: "call",
        depth: 1,
        caller_node_id: "function::create_order",
      },
      { seq: 6, node_id: "function::format_currency", event: "return", depth: 1, dur_ms: 0.2 },
      { seq: 7, node_id: "function::create_order", event: "return", depth: 0, dur_ms: 2.1 },
    ],
  },
  {
    id: "checkout-declined",
    entry: "create_order(cart)  # card declined",
    created_at: "2026-07-20T11:00:00+00:00",
    status: "failed",
    steps: [
      { seq: 0, node_id: "function::create_order", event: "call", depth: 0, caller_node_id: null },
      {
        seq: 1,
        node_id: "function::PaymentClient.charge",
        event: "call",
        depth: 1,
        caller_node_id: "function::create_order",
      },
      {
        seq: 2,
        node_id: "function::PaymentClient.charge",
        event: "raise",
        depth: 1,
        error: { type: "ValueError", message: "card declined", handled: false },
      },
      {
        seq: 3,
        node_id: "function::PaymentClient.charge",
        event: "unwind",
        depth: 1,
        error: { type: "ValueError", message: "card declined", handled: false },
      },
      {
        seq: 4,
        node_id: "function::create_order",
        event: "unwind",
        depth: 0,
        error: { type: "ValueError", message: "card declined", handled: false },
      },
    ],
  },
];

/** Canned C1 diagram for the mock C1 view — stands in for a real GET /repos/{id}/c1: the fixture
 * repo as one system, a developer actor, and an external payment provider it charges through.
 * 036-shared-diagram-style-catalog: flat nodes[] + parent, same shared shape every kind uses now
 * (node_id comes pre-attached, standing in for what the real resolve_diagram would attach). */
const MOCK_C1: Diagram = {
  type: "c1",
  nodes: [
    {
      id: "system", name: "Shadow App", node_id: null,
      description: "Handles user accounts, billing, and invoicing for the sample fixture repo.",
      kind: "system",
    },
    {
      id: "backend", name: "Backend", parent: "system",
      description: "The FastAPI half of the fixture app.",
      path: "shadow-app/backend", node_id: "folder::shadow-app/backend",
    },
    {
      id: "routers", name: "API routers", parent: "backend",
      path: "shadow-app/backend/routers", node_id: "folder::shadow-app/backend/routers",
    },
    {
      id: "domain", name: "Domain services", parent: "backend",
      description: "Business rules, split by the entity they own.",
      path: "shadow-app/backend/domain", node_id: "folder::shadow-app/backend/domain",
    },
    {
      id: "orders", name: "Order rules", parent: "domain",
      path: "shadow-app/backend/domain/order_service.py",
      node_id: "file::shadow-app/backend/domain/order_service.py",
    },
    {
      id: "frontend", name: "Frontend", parent: "system",
      path: "shadow-app/frontend/src", node_id: "folder::shadow-app/frontend/src",
    },
    {
      id: "developer", name: "Developer", node_id: null, kind: "person",
      description: "Browses the architecture and runs analyses against the repo.",
    },
    {
      id: "payment-provider", name: "Payment Provider", node_id: null, kind: "external_system",
      description: "Processes card charges for the billing service.",
    },
    {
      id: "payment-client", name: "Payment client", parent: "payment-provider",
      path: "shadow-app/backend/clients/payment_client.py",
      node_id: "file::shadow-app/backend/clients/payment_client.py",
    },
    {
      id: "webhooks", name: "Webhooks", parent: "payment-provider",
      path: "shadow-app/backend/webhooks", node_id: null,
    },
  ],
  relations: [
    { from: "developer", to: "system", label: "Browses architecture, runs analysis" },
    { from: "system", to: "payment-provider", label: "Charges accounts via" },
    { from: "routers", to: "domain", label: "Delegates request handling to" },
    { from: "orders", to: "payment-client", label: "Charges through" },
    { from: "frontend", to: "routers", label: "Calls" },
  ],
};

/** A small Impact slice covering the same boxes MOCK_IMPACT_CHANGES reviews below — real graph
 * `node_id`s borrowed from MOCK_C1's own fixture nodes, since impact boxes don't carry a `path` the
 * way c1 blocks do (see resolve_impact_changes). */
const MOCK_IMPACT: Diagram = {
  type: "impact",
  nodes: [
    { id: "system", name: "Shadow App", node_id: "system" },
    { id: "backend", name: "Backend", node_id: "folder::shadow-app/backend" },
    { id: "routers", name: "API routers", node_id: "folder::shadow-app/backend/routers" },
    { id: "domain", name: "Domain services", node_id: "folder::shadow-app/backend/domain" },
    {
      id: "orders", name: "Order rules",
      node_id: "file::shadow-app/backend/domain/order_service.py",
    },
    {
      id: "payment-client", name: "Payment client",
      node_id: "file::shadow-app/backend/clients/payment_client.py",
    },
    { id: "payment-provider", name: "Payment Provider", node_id: "payment-provider" },
  ],
  relations: [
    { from: "system", to: "payment-provider", label: "Charges accounts via" },
    { from: "routers", to: "domain", label: "Delegates request handling to" },
    { from: "orders", to: "payment-client", label: "Charges through" },
  ],
};

/** Canned change review for the mock — stands in for GET /repos/{id}/impact-changes, which on a
 * real bridge is git's block mapping merged with an agent-written .codechroma/impact-changes.json.
 * Reported as already-reviewed and not stale, so the canvas has no reason to try spawning a
 * `claude -p` run it can't run here. Blocks are addressed by their own flat id, matching MOCK_IMPACT's
 * own node ids. */
const MOCK_IMPACT_CHANGES: ImpactChanges = {
  fingerprint: "mock-fingerprint",
  reviewed_fingerprint: "mock-fingerprint",
  has_review: true,
  stale: false,
  summary:
    "Order pricing moved out of the router and into the domain layer, and the payment client " +
    "gained a webhook verification step. The frontend is untouched.",
  blocks: [
    {
      // A pure rollup ancestor — badged because a descendant changed, but nothing of its own to
      // show (mirrors the real bridge's `_roll_up`, which gives every ancestor an entry). Clicking
      // it should behave exactly like it does outside diff mode (open its real folder), not an
      // empty review.
      block: "backend",
      node_id: "backend",
      name: "Backend",
      path: "shadow-app/backend",
      status: "modified",
      files: [],
      change_count: 2,
      before: "",
      after: "",
      explanation: "",
      pr_comments: [],
    },
    {
      block: "domain",
      node_id: "domain",
      name: "Domain services",
      path: "shadow-app/backend/domain",
      status: "modified",
      files: [{ path: "shadow-app/backend/domain/order_service.py", status: "modified" }],
      change_count: 2,
      before: "Order totals were computed in the router, so pricing rules lived in the HTTP layer.",
      after: "OrderService owns pricing; the router just validates input and delegates.",
      explanation: "Pricing needed to be reused by the webhook path, which has no HTTP request.",
      pr_comments: [],
    },
    {
      block: "orders",
      node_id: "orders",
      name: "Order rules",
      path: "shadow-app/backend/domain/order_service.py",
      status: "modified",
      files: [{ path: "shadow-app/backend/domain/order_service.py", status: "modified" }],
      change_count: 1,
      before: "calculate_total summed line items with no discount handling.",
      after: "calculate_total applies tiered discounts before tax.",
      explanation: "The discount tiers were previously hard-coded in the frontend.",
      pr_comments: [
        {
          author: "reviewer-jane",
          body: "Should the top discount tier be configurable instead of hard-coded at 20%?",
          created_at: "2026-07-30T10:15:00Z",
          path: "shadow-app/backend/domain/order_service.py",
          line: 42,
        },
      ],
    },
    {
      block: "payment-client",
      node_id: "payment-client",
      name: "Payment client",
      path: "shadow-app/backend/clients/payment_client.py",
      status: "added",
      files: [{ path: "shadow-app/backend/clients/payment_client.py", status: "added" }],
      change_count: 1,
      before: "",
      after: "Wraps the provider's charge and webhook-verification endpoints.",
      explanation: "New file — charges used to be issued inline from the billing router.",
      pr_comments: [],
    },
  ],
  ghosts: [
    {
      id: "inline-pricing",
      node_id: "impact-ghost::routers/inline-pricing",
      parent: "routers",
      parent_node_id: "routers",
      name: "Inline pricing",
      status: "removed",
      before: "The router's own total/discount arithmetic, duplicated per endpoint.",
      after: "",
      explanation: "Deleted — the domain layer owns pricing now.",
    },
  ],
  relationships: [
    {
      from: "system",
      to: "payment-provider",
      label: "Verifies webhooks against",
      status: "added",
      explanation: "The new client checks webhook signatures before trusting a callback.",
      from_node_id: "system",
      to_node_id: "payment-provider",
    },
    {
      from: "orders",
      to: "payment-client",
      label: "Charges through",
      status: "added",
      explanation: "Order settlement now goes through the shared payment client.",
      from_node_id: "orders",
      to_node_id: "payment-client",
    },
  ],
  unassigned: [{ path: "README.md", status: "modified" }],
  changed_file_count: 3,
  general_pr_comments: [
    {
      author: "reviewer-jane",
      body: "Overall this looks good — just the one inline question about the discount tier.",
      created_at: "2026-07-30T10:20:00Z",
      path: null,
      line: null,
    },
  ],
};

/** Canned Patterns view fixture — a Strategy dispatch and a Registry sharing `class::Settings` as
 * both the Strategy's dispatcher and the Registry's own class, plus one confirmed Facade wrapping
 * three unresolved sub-objects. Real fixture node ids so a click opens the same Inspector panel as
 * the hierarchy view. 036-shared-diagram-style-catalog: one node per instance (kind:
 * "pattern-instance") plus one per participant (parent: the instance's id) -- `class::Settings`
 * is only ever one node (owned by the Strategy instance it's listed under first); the Registry's
 * own relation to it still resolves, since both instances address it by the same shared id. */
const MOCK_PATTERNS: Diagram = {
  type: "patterns",
  nodes: [
    {
      id: "strategy::class::BaseRepository", node_id: null, kind: "pattern-instance",
      name: "Strategy — repository dispatch",
      description: "Order/user persistence swaps its backing store behind one shared interface.",
      meta: { type: "strategy", confirmed: true, confidence: 0.9 },
    },
    {
      id: "class::BaseRepository", parent: "strategy::class::BaseRepository",
      name: "BaseRepository", node_id: "class::BaseRepository", meta: { role: "interface" },
    },
    {
      id: "class::OrderRepository", parent: "strategy::class::BaseRepository",
      name: "OrderRepository", node_id: "class::OrderRepository",
      meta: { role: "implementation" },
    },
    {
      id: "class::UserRepository", parent: "strategy::class::BaseRepository",
      name: "UserRepository", node_id: "class::UserRepository", meta: { role: "implementation" },
    },
    {
      id: "class::Settings", parent: "strategy::class::BaseRepository",
      name: "Settings", node_id: "class::Settings", meta: { role: "dispatcher" },
    },
    {
      id: "registry::class::Settings", node_id: null, kind: "pattern-instance",
      name: "Registry — Settings",
      description: "Holds every configured client keyed by name, populated once at startup.",
      meta: { type: "registry", confirmed: true, confidence: 0.85 },
    },
    {
      id: "class::EmailClient", parent: "registry::class::Settings",
      name: "EmailClient", node_id: "class::EmailClient", meta: { role: "entry" },
    },
    {
      id: "facade::class::PaymentClient", node_id: null, kind: "pattern-instance",
      name: "Facade — PaymentClient",
      meta: { type: "facade", confirmed: true, confidence: 0.35 },
    },
    {
      id: "class::PaymentClient", parent: "facade::class::PaymentClient",
      name: "PaymentClient", node_id: "class::PaymentClient", meta: { role: "facade" },
    },
    {
      id: "attr::gateway", parent: "facade::class::PaymentClient",
      name: "gateway", node_id: null, meta: { role: "target" },
    },
    {
      id: "attr::ledger", parent: "facade::class::PaymentClient",
      name: "ledger", node_id: null, meta: { role: "target" },
    },
    {
      id: "attr::fraud_check", parent: "facade::class::PaymentClient",
      name: "fraud_check", node_id: null, meta: { role: "target" },
    },
    // Authored-only connective context -- free nodes the skill added so the clusters above read as
    // one system, not isolated shapes.
    { id: "infra::api-app", name: "API App", node_id: "file::shadow-app/backend/config.py", kind: "infra" },
    { id: "ext::postgres", name: "PostgreSQL", node_id: null, kind: "external", description: "Backing store." },
  ],
  relations: [
    { from: "class::OrderRepository", to: "class::BaseRepository", kind: "implements" },
    { from: "class::UserRepository", to: "class::BaseRepository", kind: "implements" },
    { from: "class::Settings", to: "class::BaseRepository", kind: "uses" },
    { from: "class::EmailClient", to: "class::Settings", kind: "registers" },
    { from: "class::PaymentClient", to: "attr::gateway", kind: "wraps" },
    { from: "class::PaymentClient", to: "attr::ledger", kind: "wraps" },
    { from: "class::PaymentClient", to: "attr::fraud_check", kind: "wraps" },
    { from: "infra::api-app", to: "class::BaseRepository", kind: "uses", label: "Routes through" },
    { from: "class::OrderRepository", to: "ext::postgres", kind: "uses", label: "Persists to" },
  ],
  generated_at: "2026-01-01T00:00:00Z",
  has_diagram: true,
  fingerprint: "mock-fingerprint",
  reviewed_fingerprint: "mock-fingerprint",
  stale: false,
};

/** hub: expose the shared config resolver — a story, addressable both nested (under EP-A-01) and
 * as its own top-level fetch, since the real bridge lists every tier flat (list_items() has no
 * concept of "top-level only") and the view fetches whichever id the user expands, story or epic. */
const STORY_EP_A_01_01: EpicWorkItem = {
  id: "EP-A-01-01",
  title: "hub: expose the shared config resolver",
  status: "Done",
  kind: "story",
  summary: "",
  group: "platform",
  priority: null,
  source_ref: "plan/epics/EP-A-01/EP-A-01-01-first-story.md",
  url: null,
  requirements: [],
  children: [],
  links: [],
  stages: [
    {
      kind: "spec",
      name: "001-first-story-feature",
      status: "Draft",
      done: null,
      total: null,
      sections: [],
      source_ref: "specs/001-first-story-feature/spec.md",
    },
    {
      kind: "tasks",
      name: "001-first-story-feature",
      status: null,
      done: 3,
      total: 4,
      sections: [
        {
          title: "Phase 1: Setup",
          items: [
            {
              id: "T001",
              text: "T001 Create config/resolver.py skeleton",
              done: true,
              story: null,
              parallel: false,
            },
            {
              id: "T002",
              text: "T002 [P] Add fixture config files",
              done: true,
              story: null,
              parallel: true,
            },
          ],
          done: 2,
          total: 2,
        },
        {
          title: "Phase 2: Core",
          items: [
            {
              id: "T003",
              text: "T003 Implement resolve_config() with process-wide caching",
              done: true,
              story: null,
              parallel: false,
            },
            {
              id: "T004",
              text: "T004 Fall back to defaults when the config file is missing",
              done: false,
              story: null,
              parallel: false,
            },
          ],
          done: 1,
          total: 2,
        },
      ],
      source_ref: "specs/001-first-story-feature/tasks.md",
    },
  ],
};

const STORY_EP_A_01_02: EpicWorkItem = {
  id: "EP-A-01-02",
  title: "hub: unify the logging format",
  status: "In progress",
  kind: "story",
  summary: "",
  group: "platform",
  priority: null,
  source_ref: "plan/epics/EP-A-01/EP-A-01-02-second-story.md",
  url: null,
  requirements: [],
  children: [],
  links: [],
  stages: [],
};

const STORY_EP_A_02_01: EpicWorkItem = {
  id: "EP-A-02-01",
  title: "billing: publish settlement events",
  status: "Planned",
  kind: "story",
  summary: "",
  group: "billing",
  priority: null,
  source_ref: "plan/epics/EP-A-02/EP-A-02-01-third-story.md",
  url: null,
  requirements: [],
  children: [],
  links: [],
  stages: [],
};

/** A reporting epic named by EP-A-02's `enables` link but with no listing entry of its own — the
 * mock still serves it once promoted, exactly as a real markdown file recovered after the fact
 * would (FR-012/FR-014): the stub disappears and this box takes its place. */
const STUB_EP_Z_99: EpicWorkItem = {
  id: "EP-Z-99",
  title: "a future reporting epic",
  status: "Planned",
  kind: "epic",
  summary: "",
  group: null,
  priority: null,
  source_ref: "plan/epics/EP-Z-99-future-reporting.md",
  url: null,
  requirements: [],
  children: [],
  links: [],
  stages: [],
};

/** Canned Epics-view fixture, shaped like tests/fixtures/requirements_repo: two epics, three
 * stories, one cross-epic dependency (resolved, `in_index: true`) and one unmatched reference
 * (EP-Z-99, no listing entry — renders as a stub until promoted) so the mock exercises both link
 * outcomes. Every id is addressable directly too, matching the real bridge's flat listing. */
const MOCK_EPICS_ITEMS: Record<string, EpicWorkItem> = {
  "EP-A-01-01": STORY_EP_A_01_01,
  "EP-A-01-02": STORY_EP_A_01_02,
  "EP-A-02-01": STORY_EP_A_02_01,
  "EP-Z-99": STUB_EP_Z_99,
  "EP-A-01": {
    id: "EP-A-01",
    title: "Foundation: shared platform primitives",
    status: "In progress",
    kind: "epic",
    summary: "",
    group: "platform",
    priority: "Critical",
    source_ref: "plan/epics/EP-A-01-alpha-foundation.md",
    url: null,
    requirements: [
      {
        id: "checklist-1",
        text: "Every service can resolve a shared config object without duplicating parsing logic.",
        kind: "checklist",
        done: true,
        source_ref: "plan/epics/EP-A-01-alpha-foundation.md",
      },
      {
        id: "checklist-2",
        text: "A shared logging format is available to every service.",
        kind: "checklist",
        done: true,
        source_ref: "plan/epics/EP-A-01-alpha-foundation.md",
      },
      {
        id: "checklist-3",
        text: "Every service's health check reports the same shape.",
        kind: "checklist",
        done: false,
        source_ref: "plan/epics/EP-A-01-alpha-foundation.md",
      },
    ],
    children: [STORY_EP_A_01_01, STORY_EP_A_01_02],
    links: [],
    // A spec attaches to the epic itself, not just a story (the 008-epics-ai-brief flow) — exercises
    // every artifact kind's label and a tasks stage's phase/section tier in the mock, same as the
    // real bridge's SpeckitDeliverySource would for a feature dir naming EP-A-01 in its Input block.
    stages: [
      {
        kind: "spec",
        name: "008-model-shaped-serving-units",
        status: "Draft",
        done: null,
        total: null,
        sections: [],
        source_ref: "specs/008-model-shaped-serving-units/spec.md",
      },
      {
        kind: "plan",
        name: "008-model-shaped-serving-units",
        status: "Ready",
        done: null,
        total: null,
        sections: [],
        source_ref: "specs/008-model-shaped-serving-units/plan.md",
      },
      {
        kind: "tasks",
        name: "008-model-shaped-serving-units",
        status: null,
        done: 1,
        total: 4,
        sections: [
          {
            title: "Phase 1: Setup",
            items: [
              {
                id: "T001",
                text: "T001 [P] [US1] Scaffold the serving-units API module",
                done: true,
                story: "US1",
                parallel: true,
              },
              {
                id: "T002",
                text: "T002 [US1] Wire the module into the router",
                done: false,
                story: "US1",
                parallel: false,
              },
            ],
            done: 1,
            total: 2,
          },
          {
            title: "Phase 2: Polish",
            items: [
              { id: "T003", text: "T003 Add integration tests", done: false, story: null, parallel: false },
              { id: "T004", text: "T004 Update docs", done: false, story: null, parallel: false },
            ],
            done: 0,
            total: 2,
          },
        ],
        source_ref: "specs/008-model-shaped-serving-units/tasks.md",
      },
      {
        kind: "research",
        name: "008-model-shaped-serving-units",
        status: "Draft",
        done: null,
        total: null,
        sections: [],
        source_ref: "specs/008-model-shaped-serving-units/research.md",
      },
      {
        kind: "data-model",
        name: "008-model-shaped-serving-units",
        status: null,
        done: null,
        total: null,
        sections: [],
        source_ref: "specs/008-model-shaped-serving-units/data-model.md",
      },
    ],
  },
  "EP-A-02": {
    id: "EP-A-02",
    title: "Integration: connect the billing pipeline",
    status: "Planned",
    kind: "epic",
    summary: "",
    group: null,
    priority: null,
    source_ref: "plan/epics/EP-A-02-beta-integration.md",
    url: null,
    requirements: [
      {
        id: "checklist-1",
        text: "Billing events publish onto the shared bus.",
        kind: "checklist",
        done: false,
        source_ref: "plan/epics/EP-A-02-beta-integration.md",
      },
    ],
    children: [STORY_EP_A_02_01],
    links: [
      { id: "EP-A-01", relation: "depends_on", title: "the foundation epic", in_index: true },
      { id: "EP-Z-99", relation: "enables", title: "a future reporting epic", in_index: false },
    ],
    stages: [],
  },
};

/** Every item the mock index lists — a work item summary strips its own children's detail so the
 * story ids above still get their own top-level collapsed box, matching the real bridge's flat
 * listing (list_items() reads frontmatter only, whatever tier the item sits at). */
const MOCK_EPICS_INDEX: EpicsIndex = {
  source: "file://plan/epics",
  groups: ["billing", "platform", null],
  items: [
    {
      id: "EP-A-01",
      title: MOCK_EPICS_ITEMS["EP-A-01"].title,
      status: "In progress",
      kind: "epic",
      group: "platform",
    },
    {
      id: "EP-A-01-01",
      title: "hub: expose the shared config resolver",
      status: "Done",
      kind: "story",
      group: "platform",
    },
    {
      id: "EP-A-01-02",
      title: "hub: unify the logging format",
      status: "In progress",
      kind: "story",
      group: "platform",
    },
    {
      id: "EP-A-02",
      title: MOCK_EPICS_ITEMS["EP-A-02"].title,
      status: "Planned",
      kind: "epic",
      group: null,
    },
    {
      id: "EP-A-02-01",
      title: "billing: publish settlement events",
      status: "Planned",
      kind: "story",
      group: "billing",
    },
  ],
  omitted: 0,
  generated_at: "2026-01-01T00:00:00Z",
};

const MOCK_EPIC_BRIEF: EpicBrief = {
  epic_id: "EP-A-01",
  generated_at: "2026-01-01T00:00:00Z",
  problem: [
    "Every service re-derives its own config, logging, and health-check shape today, so a change to any one of them means editing every service by hand.",
  ],
  component: "application",
  spokes: [{ spoke: "application", role: "the control plane core." }],
  scope: [
    {
      id: "scope-config",
      title: "Shared config resolver",
      description: "One resolver every service imports instead of parsing its own env/YAML.",
      in_scope: true,
      tasks_source: "draft",
      out_of_scope_ref: null,
      tasks: [
        {
          id: "T001",
          text: "extract the resolver into its own package",
          parallel: false,
          repo: "backend",
          stage: null,
        },
        {
          id: "T002",
          text: "test: two services resolve identical config from the same input",
          parallel: true,
          repo: "backend",
          stage: null,
          is_test: true,
        },
      ],
    },
    {
      id: "scope-health",
      title: "Shared health-check shape",
      description: "Every service's /health responds with the same JSON shape.",
      in_scope: true,
      tasks_source: "draft",
      out_of_scope_ref: null,
      tasks: [
        {
          id: "T003",
          text: "define the shared health-check response type",
          parallel: false,
          repo: null,
          stage: null,
        },
      ],
    },
    {
      id: "scope-dashboards",
      title: "Per-team monitoring dashboards",
      description: "Deferred to the reporting epic once shared health data exists.",
      in_scope: false,
      out_of_scope_ref: "EP-Z-99",
      tasks: [],
      tasks_source: null,
    },
  ],
  prep_tasks: [
    { id: "T000", text: "scaffold the shared platform package", parallel: false, repo: null, stage: null },
  ],
  dependencies: [
    {
      kind: "risk",
      text: "rolling out a shared resolver mid-migration risks a config drift window",
      ids: [],
    },
  ],
  acceptance: [
    {
      id: "AC-01",
      text: "every service resolves a shared config object without duplicating parsing logic",
      done: true,
      closes_scope_id: "scope-config",
    },
    {
      id: "AC-02",
      text: "every service's health check reports the same shape",
      done: false,
      closes_scope_id: "scope-health",
    },
    {
      id: "AC-03",
      text: "a shared logging format is available to every service",
      done: true,
      closes_scope_id: null,
    },
  ],
};

function mockEpicBriefFor(itemId: string): EpicBrief {
  if (itemId === MOCK_EPIC_BRIEF.epic_id) return MOCK_EPIC_BRIEF;
  const item = MOCK_EPICS_ITEMS[itemId];
  return {
    ...MOCK_EPIC_BRIEF,
    epic_id: itemId,
    problem: item
      ? [`Mock brief stand-in for "${item.title}" — no fixture written for this epic yet.`]
      : [],
  };
}

const IDLE_EPIC_BRIEF_JOB = (itemId: string): EpicBriefJobState => ({
  job_key: `mock:${itemId}`,
  state: "idle",
  error: null,
  brief: null,
});

// One in-memory job per itemId, so switching epics never mixes up "generating" state (mirrors
// mockLayouts' per-kind Record below) -- lost on reload, same as every other mock state here.
const mockEpicBriefJobs = new Map<string, EpicBriefJobState>();
// The mock brief timer per itemId, so cancelEpicBrief() can stop one before it resolves.
const mockEpicBriefTimers = new Map<string, ReturnType<typeof setTimeout>>();

// --- feature 011: user-defined custom diagrams ---
// One seeded library entry ("example-map") so `npm run dev`'s default mock mode has something to
// show the moment the Custom menu opens, plus an in-memory library the wizard's mock interview can
// add to -- both reset on reload, same as every other mock store here.

const MOCK_DIAGRAM_TYPE_EXAMPLE: DiagramTypeDefinition = {
  schema_version: 1,
  id: "example-map",
  title: "Example map",
  description: "An illustrative map of repositories and outbound clients, grouped by role.",
  style: "boxes-arrows",
  layout: { direction: "TB" },
  grouping: { enabled: true, label: "Role" },
  relation_kinds: [
    { id: "extends", label: "extends" },
    { id: "notifies", label: "notifies" },
  ],
  instructions:
    "One box per repository or outbound client; group boxes by role (Repositories vs Messaging); draw an edge for every direct call between them.",
  context_sources: ["structure", "dependency-digest"],
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

// Reuses the same real fixture node ids the Patterns mock diagram does, so a box click opens the
// real Inspector on real (fake-but-consistent) data, exactly like the live bridge would.
const MOCK_CUSTOM_DIAGRAM_EXAMPLE: Diagram = {
  has_diagram: true,
  generated_at: "2026-08-01T00:00:00Z",
  groups: ["Repositories", "Messaging"],
  nodes: [
    {
      id: "base-repo",
      name: "BaseRepository",
      description: "Shared repository base",
      group: "Repositories",
      node_id: "class::BaseRepository",
      path: null,
    },
    {
      id: "order-repo",
      name: "OrderRepository",
      description: "Order persistence",
      group: "Repositories",
      node_id: "class::OrderRepository",
      path: null,
    },
    {
      id: "user-repo",
      name: "UserRepository",
      description: "User persistence",
      group: "Repositories",
      node_id: "class::UserRepository",
      path: null,
    },
    {
      id: "email-client",
      name: "EmailClient",
      description: "Sends notification emails",
      group: "Messaging",
      node_id: "class::EmailClient",
      path: null,
    },
    {
      id: "payment-client",
      name: "PaymentClient",
      description: "Talks to the payment gateway",
      group: "Messaging",
      node_id: "class::PaymentClient",
      path: null,
    },
  ],
  relations: [
    { from: "order-repo", to: "base-repo", kind: "extends", label: "extends" },
    { from: "user-repo", to: "base-repo", kind: "extends", label: "extends" },
    { from: "order-repo", to: "email-client", kind: "notifies", label: "notifies" },
    { from: "order-repo", to: "payment-client", kind: "notifies", label: "charges via" },
  ],
};

/** The library, in memory -- what listDiagramTypes reads. Seeded with one type so the Diagrams tab's
 * "Available to add" section is never empty in mock mode. The in-app interview that used to write
 * into this map is retired (diagram-management unification); nothing adds to it at runtime anymore. */
const mockDiagramTypes = new Map<string, DiagramTypeDefinition>([
  ["example-map", MOCK_DIAGRAM_TYPE_EXAMPLE],
]);

/** One generated diagram per library type, keyed the same way. Only "example-map" starts non-empty
 * -- generateDiagram is unsupported in mock mode (no live `claude -p`), so a freshly-authored type
 * has nothing to show until a real bridge is used. */
const mockCustomDiagrams = new Map<string, Diagram>([
  ["example-map", MOCK_CUSTOM_DIAGRAM_EXAMPLE],
]);

function traceSummary(trace: Trace): TraceSummary {
  return {
    id: trace.id,
    entry: trace.entry,
    created_at: trace.created_at,
    status: trace.status,
    step_count: trace.steps.length,
  };
}

function stripChildren(fixture: FixtureNode): HierarchyNodeRef {
  const { children: _children, ...ref } = fixture;
  return ref;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Route probing over the mock's own fixture edges — a plain undirected BFS, hop-capped like the
 * real bridge's bidirectional search (docs/planning/019). Fine for a two-edge fixture graph; the
 * real bridge's build_dependency_index does the real work. */
const ROUTE_HOP_CAP = 12;
function bfsRoute(fromId: string, toId: string): string[] | null {
  if (fromId === toId) return [fromId];
  const adjacency = new Map<string, Set<string>>();
  for (const { from_id, to_id } of FIXTURE_CONNECTIONS) {
    if (!adjacency.has(from_id)) adjacency.set(from_id, new Set());
    if (!adjacency.has(to_id)) adjacency.set(to_id, new Set());
    adjacency.get(from_id)!.add(to_id);
    adjacency.get(to_id)!.add(from_id);
  }
  const visited = new Set([fromId]);
  const queue: string[][] = [[fromId]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (path.length > ROUTE_HOP_CAP) continue;
    const last = path[path.length - 1];
    for (const next of adjacency.get(last) ?? []) {
      if (next === toId) return [...path, next];
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}


/**
 * Fixture-backed mock implementing contracts/canvas-bridge-api.md so frontend work is unblocked
 * before the real bridge (research.md Decision 5) exists.
 */
const mockLayouts: Record<LayoutKind, DiagramLayout> = {
  c1: {},
  patterns: {},
  hierarchy: {},
  epics: {},
  impact: {},
  sequence: {},
  // "canvas" has no saved-layout GET/POST route (a CanvasNodeBox's position lives on canvas.json,
  // not here) -- present only so this literal stays exhaustive over LayoutKind like every other
  // non-live kind already does (see the type's own comment in state/types.ts).
  canvas: {},
};

let mockCanvasIdCounter = 0;
function nextMockCanvasId(): string {
  mockCanvasIdCounter += 1;
  return `mock-${mockCanvasIdCounter}`;
}

/** A slimmed-down, in-memory stand-in for `codechroma.canvas.apply_batch` (016-single-canvas-
 * dashboard) — enough op coverage for frontend dev/tests against the mock bridge, not a faithful
 * port of every rejection code (the real caps live server-side; see docs/architecture/single-canvas.md). */
/** JS mirror of apply_batch.py's `_sanitize_style` -- drops any key outside the allow-list. */
function sanitizeMockStyle(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object") return null;
  const filtered: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string" && STYLE_ALLOWED_KEYS.includes(key)) filtered[key] = val;
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
}

function applyMockCanvasBatch(
  doc: CanvasDoc,
  ops: CanvasBatch["ops"],
): { doc: CanvasDoc; result: CanvasBatchResult } {
  const elements = { ...doc.elements };
  const edges = { ...doc.edges };
  const idMap: Record<string, string> = {};
  const affected: string[] = [];
  const errors: CanvasOpError[] = [];
  const resolveElement = (ref: string | undefined): string | null => {
    if (!ref) return null;
    const real = idMap[ref] ?? ref;
    return elements[real] ? real : null;
  };
  const resolveEdge = (ref: string | undefined): string | null => {
    if (!ref) return null;
    const real = idMap[ref] ?? ref;
    return edges[real] ? real : null;
  };

  ops.forEach((op, index) => {
    switch (op.op) {
      case "add_element":
      case "add_group":
      case "add_note": {
        const id = nextMockCanvasId();
        const element: CanvasElement = {
          id,
          render: (op.render ?? (op.op === "add_group" ? "group" : "note")) as CanvasElement["render"],
          layer: op.layer ?? "default",
          label: op.label ?? "",
          description: op.description ?? "",
          node_id: op.node_id ?? null,
          position: op.position ?? { x: 0, y: 0 },
          size: op.size ?? null,
          group_id: op.group_id ? (idMap[op.group_id] ?? op.group_id) : null,
          meta: op.meta ?? {},
          created_by: op.created_by ?? "ai",
          style: sanitizeMockStyle(op.style),
        };
        elements[id] = element;
        if (op.temp_id) idMap[op.temp_id] = id;
        affected.push(id);
        return;
      }
      case "add_edge": {
        const from = resolveElement(op.from);
        const to = resolveElement(op.to);
        if (!from || !to) {
          errors.push({ op_index: index, code: "unknown_target", message: "unknown edge endpoint" });
          return;
        }
        const id = nextMockCanvasId();
        const edge: CanvasEdge = {
          id,
          from,
          to,
          label: op.label ?? "",
          kind: op.kind ?? "uses",
          layer: op.layer ?? "default",
          ...(op.transport !== undefined ? { transport: op.transport } : {}),
          ...(op.style !== undefined ? { style: sanitizeMockStyle(op.style) } : {}),
        };
        edges[id] = edge;
        if (op.temp_id) idMap[op.temp_id] = id;
        affected.push(id);
        return;
      }
      case "update_element": {
        const id = resolveElement(op.id);
        if (!id) {
          errors.push({ op_index: index, code: "unknown_target", message: "unknown element" });
          return;
        }
        elements[id] = {
          ...elements[id],
          ...(op.label !== undefined ? { label: op.label } : {}),
          ...(op.description !== undefined ? { description: op.description } : {}),
          ...(op.position !== undefined ? { position: op.position } : {}),
          ...(op.size !== undefined ? { size: op.size } : {}),
          ...(op.group_id !== undefined ? { group_id: op.group_id } : {}),
          ...(op.meta !== undefined ? { meta: op.meta } : {}),
          ...(op.layer !== undefined ? { layer: op.layer } : {}),
          ...(op.created_by !== undefined ? { created_by: op.created_by } : {}),
          // Replaced, not merged -- matches apply_batch.py; `style: null` clears a highlight.
          ...(op.style !== undefined ? { style: sanitizeMockStyle(op.style) } : {}),
        };
        affected.push(id);
        return;
      }
      case "update_edge": {
        const id = resolveEdge(op.id);
        if (!id) {
          errors.push({ op_index: index, code: "unknown_target", message: "unknown edge" });
          return;
        }
        edges[id] = {
          ...edges[id],
          ...(op.label !== undefined ? { label: op.label } : {}),
          ...(op.kind !== undefined ? { kind: op.kind } : {}),
          ...(op.layer !== undefined ? { layer: op.layer } : {}),
          ...(op.transport !== undefined ? { transport: op.transport } : {}),
          // Replaced, not merged -- matches apply_batch.py; `style: null` clears an override.
          ...(op.style !== undefined ? { style: sanitizeMockStyle(op.style) } : {}),
        };
        affected.push(id);
        return;
      }
      case "delete_element": {
        const id = resolveElement(op.id);
        if (!id) {
          errors.push({ op_index: index, code: "unknown_target", message: "unknown element" });
          return;
        }
        delete elements[id];
        affected.push(id);
        Object.values(edges)
          .filter((edge) => edge.from === id || edge.to === id)
          .forEach((edge) => {
            delete edges[edge.id];
            affected.push(edge.id);
          });
        return;
      }
      case "delete_edge": {
        const id = resolveEdge(op.id);
        if (!id) {
          errors.push({ op_index: index, code: "unknown_target", message: "unknown edge" });
          return;
        }
        delete edges[id];
        affected.push(id);
        return;
      }
      default:
        errors.push({ op_index: index, code: "unknown_op", message: `unknown op ${String(op.op)}` });
    }
  });

  if (errors.length > 0) return { doc, result: { ok: false, errors } };
  const nextDoc: CanvasDoc = {
    ...doc,
    elements,
    edges,
    updated_at: new Date().toISOString(),
  };
  return {
    doc: nextDoc,
    result: { ok: true, batch_id: nextMockCanvasId(), id_map: idMap, affected: [...new Set(affected)] },
  };
}

// A Record, not a ternary ladder: a new fixed kind fails to typecheck instead of silently falling
// into the last branch's payload. `` `custom/${string}` `` is an open-ended family (feature 011: a
// new type is data, not code), so getDiagram() below special-cases it against mockCustomDiagrams
// instead of enumerating it here.
const MOCK_DIAGRAMS: { [K in "c1" | "patterns" | "impact" | "epics"]: DiagramPayload[K] } = {
  c1: MOCK_C1,
  patterns: MOCK_PATTERNS,
  impact: MOCK_IMPACT,
  epics: MOCK_EPICS_INDEX,
};

// --- 016-single-canvas-dashboard, Stage 4: a JS port of canvas/recipes.py's to_ops + build_batch_ops,
// simplified for the mock -- enough to demo Draw…/AgentRail's Diagrams tab against fixture data in
// `npm run dev`.

interface MockRecipeNode {
  key: string;
  render: CanvasElement["render"];
  label: string;
  description?: string;
  node_id?: string | null;
  group?: string | null;
  meta?: Record<string, unknown>;
}

interface MockRecipeEdge {
  from_key: string;
  to_key: string;
  label?: string;
  kind?: string;
}

const MOCK_RECIPE_KEY = "recipe_key";

function mockGroupKey(group: string): string {
  return `__group__::${group}`;
}

/** Mirrors `build_batch_ops`'s ownership rule: only touches `layer`'s own `created_by: "ai"`
 * elements, matched by `meta.recipe_key`, so a re-run never disturbs a user-placed element. */
function buildMockRecipeOps(
  doc: CanvasDoc,
  layer: string,
  nodes: MockRecipeNode[],
  edges: MockRecipeEdge[],
): CanvasOp[] {
  const existingByKey = new Map<string, CanvasElement>();
  for (const element of Object.values(doc.elements)) {
    const key = element.meta[MOCK_RECIPE_KEY];
    if (element.layer === layer && element.created_by === "ai" && typeof key === "string") {
      existingByKey.set(key, element);
    }
  }
  const ops: CanvasOp[] = [];
  const seenKeys = new Set<string>();
  const refFor = new Map<string, string>();

  const groups = [...new Set(nodes.map((n) => n.group).filter((g): g is string => Boolean(g)))].sort();
  const groupRef = new Map<string, string>();
  for (const group of groups) {
    const groupKey = mockGroupKey(group);
    seenKeys.add(groupKey);
    const existing = existingByKey.get(groupKey);
    if (existing) {
      groupRef.set(group, existing.id);
    } else {
      const tempId = `g${ops.length}`;
      groupRef.set(group, tempId);
      ops.push({
        op: "add_group", temp_id: tempId, layer, label: group,
        meta: { [MOCK_RECIPE_KEY]: groupKey }, created_by: "ai",
      });
    }
  }

  for (const node of nodes) {
    seenKeys.add(node.key);
    const groupId = node.group ? (groupRef.get(node.group) ?? null) : null;
    const meta = { ...(node.meta ?? {}), [MOCK_RECIPE_KEY]: node.key };
    const existing = existingByKey.get(node.key);
    if (existing) {
      refFor.set(node.key, existing.id);
      ops.push({
        op: "update_element", id: existing.id, label: node.label,
        description: node.description ?? "", node_id: node.node_id ?? null,
        group_id: groupId, meta,
      });
    } else {
      const tempId = `n${ops.length}`;
      refFor.set(node.key, tempId);
      ops.push({
        op: "add_element", temp_id: tempId, render: node.render, layer,
        label: node.label, description: node.description ?? "", node_id: node.node_id ?? null,
        group_id: groupId, meta, created_by: "ai",
      });
    }
  }

  for (const [key, element] of existingByKey) {
    if (!seenKeys.has(key)) ops.push({ op: "delete_element", id: element.id });
  }

  const aiElementIds = new Set([...existingByKey.values()].map((e) => e.id));
  const existingEdgesByPair = new Map<string, CanvasEdge>();
  for (const edge of Object.values(doc.edges)) {
    if (edge.layer === layer && aiElementIds.has(edge.from) && aiElementIds.has(edge.to)) {
      existingEdgesByPair.set(`${edge.from}->${edge.to}`, edge);
    }
  }
  const seenPairs = new Set<string>();
  for (const edge of edges) {
    const fromRef = refFor.get(edge.from_key);
    const toRef = refFor.get(edge.to_key);
    if (!fromRef || !toRef) continue;
    const pairKey = `${fromRef}->${toRef}`;
    const existingEdge = aiElementIds.has(fromRef) ? existingEdgesByPair.get(pairKey) : undefined;
    if (existingEdge) {
      seenPairs.add(pairKey);
      if (existingEdge.label !== (edge.label ?? "") || existingEdge.kind !== (edge.kind ?? "uses")) {
        ops.push({
          op: "update_edge", id: existingEdge.id,
          label: edge.label ?? "", kind: edge.kind ?? "uses",
        });
      }
    } else {
      ops.push({
        op: "add_edge", from: fromRef, to: toRef,
        label: edge.label ?? "", kind: edge.kind ?? "uses", layer,
      });
    }
  }
  for (const [pairKey, edge] of existingEdgesByPair) {
    if (!seenPairs.has(pairKey)) ops.push({ op: "delete_edge", id: edge.id });
  }

  return ops;
}

interface MockRecipeResult {
  nodes: MockRecipeNode[];
  edges: MockRecipeEdge[];
}

/** One JS port of `canvas/recipes.py`'s `reshape()`+`graph_to_ops` for every diagram kind
 * (036-shared-diagram-style-catalog) -- c1/patterns/impact/custom all resolve to the one shared
 * `Diagram` shape now, so one function replaces the old `c1RecipeResult`/`patternsRecipeResult`/
 * `impactRecipeResult`/`customRecipeResult` quartet. `render` is the one thing that still varies
 * per kind, same as the real `RECIPES` table. */
function diagramRecipeResult(diagram: Diagram, render: CanvasElement["render"]): MockRecipeResult {
  const nodes: MockRecipeNode[] = diagram.nodes.map((item) => ({
    key: item.id, render, label: item.name || item.id, description: item.description ?? "",
    node_id: item.node_id, group: item.group ?? null,
    meta: { ...(item.meta ?? {}), kind: item.kind ?? undefined, icon: item.icon ?? undefined },
  }));
  const keys = new Set(nodes.map((n) => n.key));
  const edges: MockRecipeEdge[] = diagram.relations
    .filter((r) => keys.has(r.from) && keys.has(r.to))
    .map((r) => ({ from_key: r.from, to_key: r.to, label: r.label, kind: r.kind }));
  return { nodes, edges };
}

function epicsRecipeResult(index: EpicsIndex): MockRecipeResult {
  const nodes: MockRecipeNode[] = index.items.map((item) => ({
    key: item.id, render: "epic", label: item.title || item.id, group: item.group ?? null,
    meta: { status: item.status, kind: item.kind },
  }));
  return { nodes, edges: [] };
}

/** A canned sequence diagram for mock-mode demo: participants + messages (each message a mock node
 * carrying `meta.role: "message"` plus from/to/order, exactly what SequenceDiagram.tsx reads). The
 * authored participants use string ids (`client`/`api`/`db`) and messages reference them by id --
 * the same wiring the real bridge's sequence reshape emits. */
function sequenceRecipeResult(): MockRecipeResult {
  const participants: MockRecipeNode[] = [
    { key: "client", render: "sequence", label: "Client", node_id: "component::web/app.ts",
      meta: { role: "participant" } },
    { key: "api", render: "sequence", label: "API", node_id: "component::src/api/main.py",
      meta: { role: "participant" } },
    { key: "db", render: "sequence", label: "DB", node_id: "component::src/db/pg.py",
      meta: { role: "participant" } },
  ];
  const messages: MockRecipeNode[] = [
    { key: "m1", render: "sequence", label: "POST /checkout",
      description: "POST /checkout with {cartId, items[], total} — the browser sends the cart to charge.",
      meta: { role: "message", from: "client", to: "api", order: "1" } },
    { key: "m2", render: "sequence", label: "SELECT orders",
      description: "Brings back the user's open orders from PostgreSQL.",
      meta: { role: "message", from: "api", to: "db", order: "2" } },
    { key: "m3", render: "sequence", label: "200 OK",
      meta: { role: "message", from: "api", to: "client", order: "3", return: "true" } },
  ];
  return { nodes: [...participants, ...messages], edges: [] };
}

export class MockBridgeEngineClient implements EngineClient {
  // Tracks which mock diff entries have been "accepted" so a later getDiff() omits them, since
  // there's no real git repo here to actually commit against.
  private readonly acceptedNodeIds = new Set<string>();

  // An in-memory event bus (one listener set per event type), so a workspace switch's resync and
  // any emit-driven refetch are observable in mock-backed dev and tests instead of dead no-ops.
  private readonly bus = new Map<string, Set<(payload: unknown) => void>>();

  /** Registers `listener` for one event type and returns its unsubscribe fn — the mock's own `on`,
   * standing in for the real bridge's shared-events WebSocket. */
  private on<T>(type: string, listener: (payload: T) => void): () => void {
    let set = this.bus.get(type) as Set<(payload: T) => void> | undefined;
    if (!set) {
      set = new Set();
      this.bus.set(type, set as Set<(payload: unknown) => void>);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Test-facing broadcaster: delivers `payload` to every listener of `type`. */
  emit<T>(type: string, payload?: T): void {
    this.bus.get(type)?.forEach((listener) => (listener as (payload: T) => void)(payload as T));
  }

  async getNode(nodeId: string): Promise<HierarchyNodeRef | null> {
    const fixture = FIXTURE_NODES[nodeId];
    return fixture ? stripChildren(fixture) : null;
  }

  async getChildren(nodeId: string): Promise<HierarchyNodeRef[]> {
    const fixture = FIXTURE_NODES[nodeId];
    if (!fixture) return [];
    return fixture.children
      .map((childId) => FIXTURE_NODES[childId])
      .filter((child): child is FixtureNode => Boolean(child))
      .map(stripChildren);
  }

  async getConnections(nodeId: string): Promise<Connection[]> {
    return FIXTURE_CONNECTIONS.filter((c) => c.from_id === nodeId || c.to_id === nodeId);
  }

  async getRoute(fromId: string, toId: string): Promise<string[] | null> {
    return bfsRoute(fromId, toId);
  }

  async getDiff(): Promise<FunctionDiff[]> {
    await delay(300);
    const entries: FunctionDiff[] = MOCK_DIFF_TARGETS.map((nodeId) => {
      const original = FIXTURE_NODES[nodeId].source ?? "";
      return {
        node_id: nodeId,
        status: "modified",
        level: "function",
        original_source: original,
        proposed_source: `${original}\n# edited since last commit`,
      };
    });
    const container = FIXTURE_NODES[MOCK_DIFF_ADDED_CONTAINER];
    if (container) {
      entries.push({
        node_id: MOCK_DIFF_ADDED_CONTAINER,
        status: "added",
        level: "class",
        original_source: "",
        proposed_source: container.source ?? "",
      });
    }
    return entries.filter((entry) => !this.acceptedNodeIds.has(entry.node_id));
  }

  async getChangeCards(): Promise<ChangeCardSet> {
    await delay(300);
    const cards = MOCK_CHANGE_CARDS.filter((card) => Boolean(FIXTURE_NODES[card.node_id]));
    const by_node: Record<string, number> = {};
    for (const card of cards) by_node[card.node_id] = (by_node[card.node_id] ?? 0) + 1;
    return {
      base: "mock-base",
      base_resolved: true,
      card_count: cards.length,
      cards,
      by_node,
      by_node_status: byNodeStatus(cards),
      unassigned: [],
    };
  }

  async acceptDiff(nodeId: string): Promise<void> {
    await delay(200);
    this.acceptedNodeIds.add(nodeId);
  }

  async getDiagram<K extends DiagramFetchKind>(kind: K): Promise<DiagramPayloadFor<K>> {
    await delay(300);
    if (kind.startsWith("custom/")) {
      const typeId = kind.slice("custom/".length);
      return (mockCustomDiagrams.get(typeId) ?? EMPTY_DIAGRAM) as DiagramPayloadFor<K>;
    }
    return MOCK_DIAGRAMS[kind as "c1" | "patterns" | "impact" | "epics"] as DiagramPayloadFor<K>;
  }

  async getSidecar<K extends SidecarKind>(kind: K): Promise<SidecarPayload[K]> {
    await delay(300);
    // MOCK_C1's two top blocks are shadow-app/backend and shadow-app/frontend/src, which between
    // them hold every file in the fixture -- so full coverage and no remainder block is the honest
    // answer here. The partial splits the mock does exercise are the per-block `unmapped_ids` above.
    const payload: SidecarPayload = {
      changes: MOCK_IMPACT_CHANGES,
      coverage: {
        has_diagram: true,
        total_files: FIXTURE_FILE_COUNT,
        covered_files: FIXTURE_FILE_COUNT,
        unmapped_files: 0,
        percent: 100,
        entries: [],
        truncated: false,
      },
    };
    return payload[kind];
  }

  subscribeSidecar = (kind: SidecarKind, onChange: () => void): (() => void) =>
    this.on(kind === "changes" ? "impact-changes" : "c1", onChange);

  /** No real skill run is possible without a live backend — the empty-state Retry falls back to
   * the static "ask your AI assistant" message instead of spinning forever. The change review is
   * already "reviewed" in the fixture, so the canvas never tries to spawn one either. */
  async generateDiagram(
    _kind: SkillRunKind,
    _options?: DiagramGenerationOptions,
  ): Promise<DiagramGenerationStatus> {
    return { state: "error", error: "not supported in mock mode" };
  }

  async getDiagramStatus(_kind: SkillRunKind): Promise<DiagramGenerationStatus> {
    return { state: "idle", error: null };
  }

  async cancelDiagram(_kind: SkillRunKind): Promise<DiagramGenerationStatus> {
    return { state: "idle", error: null };
  }

  // No run means no progress feed either; the panel that reads these never mounts in mock mode.
  async getDiagramOutput(_kind: SkillRunKind): Promise<string[]> {
    return [];
  }

  // In-memory only — drag stays live within a session, but the mock persists nothing across reload.
  async getDiagramLayout(kind: LayoutKind): Promise<DiagramLayout> {
    return { ...mockLayouts[kind] };
  }

  async saveDiagramLayout(kind: LayoutKind, layout: DiagramLayout): Promise<void> {
    mockLayouts[kind] = { ...layout };
  }

  // In-memory only, per client instance (a workspace switch gets a fresh one) — mirrors one
  // .codechroma/canvas.json per workspace without persisting across reload.
  private canvasDoc: CanvasDoc = { ...SEEDED_CANVAS_DOC, doc_id: "mock" };

  async getCanvas(): Promise<CanvasDoc> {
    return this.canvasDoc;
  }

  async patchCanvas(batch: CanvasBatch): Promise<CanvasBatchResult> {
    const { doc, result } = applyMockCanvasBatch(this.canvasDoc, batch.ops);
    if (!result.ok) return result;
    this.canvasDoc = doc;
    this.emit<CanvasPing>("canvas", {
      type: "canvas",
      batch_id: result.batch_id,
      affected: result.affected,
      new_elements: Object.values(result.id_map),
    });
    return result;
  }

  subscribeCanvas(onChange: (ping: CanvasPing) => void): () => void {
    return this.on("canvas", onChange);
  }

  async runRecipe(recipe: string): Promise<CanvasBatchResult> {
    await delay(150);
    let built: MockRecipeResult;
    if (recipe === "c1") built = diagramRecipeResult(MOCK_C1, "c1");
    else if (recipe === "patterns") built = diagramRecipeResult(MOCK_PATTERNS, "pattern");
    else if (recipe === "impact") built = diagramRecipeResult(MOCK_IMPACT, "impact");
    else if (recipe === "epics") built = epicsRecipeResult(MOCK_EPICS_INDEX);
    else if (recipe === "sequence") built = sequenceRecipeResult();
    else if (recipe.startsWith("custom/")) {
      const typeId = recipe.slice("custom/".length);
      built = diagramRecipeResult(mockCustomDiagrams.get(typeId) ?? EMPTY_DIAGRAM, "custom");
    } else {
      return {
        ok: false,
        errors: [{ op_index: -1, code: "unknown_recipe", message: `unknown recipe: ${recipe}` }],
      };
    }
    const ops = buildMockRecipeOps(this.canvasDoc, recipe, built.nodes, built.edges);
    const { doc, result } = applyMockCanvasBatch(this.canvasDoc, ops);
    if (result.ok) {
      this.canvasDoc = doc;
      this.emit<CanvasPing>("canvas", {
        type: "canvas", batch_id: result.batch_id,
        affected: result.affected, new_elements: Object.values(result.id_map),
      });
    }
    return result;
  }

  async getDiagramsStatus(): Promise<DiagramsStatus> {
    await delay(150);
    const hasLayer = (layer: string): boolean =>
      Object.values(this.canvasDoc.elements).some((element) => element.layer === layer);
    return {
      c1: { ready: hasLayer("c1") },
      patterns: { ready: hasLayer("patterns") },
      impact: { ready: hasLayer("impact") },
      sequence: { ready: hasLayer("sequence") },
      ...Object.fromEntries(
        [...mockDiagramTypes.keys()].map((id) => [
          `custom/${id}`,
          { ready: mockCustomDiagrams.has(id) },
        ]),
      ),
    };
  }

  async deleteDiagram(kind: string): Promise<{ deleted: boolean }> {
    await delay(150);
    if (kind.startsWith("custom/")) {
      // The saved type definition (mockDiagramTypes) is deliberately untouched -- only this
      // repo's own generated instance goes away, same split the real library/registry draw.
      const typeId = kind.slice("custom/".length);
      return { deleted: mockCustomDiagrams.delete(typeId) };
    }
    // c1/patterns/impact/feature-plan have no separate mock-only artifact store: their
    // getDiagramsStatus readiness already derives from the canvas doc, so removing the canvas
    // layer (the caller's own follow-up removeLayerAndRefresh) is the only state that changes.
    return { deleted: true };
  }

  async listTraces(): Promise<TraceSummary[]> {
    await delay(300);
    return MOCK_TRACES.map(traceSummary);
  }

  async getEpicsItem(itemId: string): Promise<EpicWorkItem> {
    await delay(300);
    const item = MOCK_EPICS_ITEMS[itemId];
    if (!item) throw new Error(`unknown work item: ${itemId}`);
    return item;
  }

  async getSourceFragment(path: string): Promise<SourceFragment> {
    return { path, content: "", language: "markdown" };
  }

  async getTrace(traceId: string): Promise<Trace> {
    await delay(300);
    const trace = MOCK_TRACES.find((t) => t.id === traceId);
    if (!trace) throw new Error(`unknown trace: ${traceId}`);
    return trace;
  }

  /** Starts (or attaches to) a mock brief run -- a cached brief returns inline, otherwise this
   * flips to "generating" and a timer resolves it to the fixture brief shortly after, so the
   * canvas's generate affordance and its poll loop both have something real to show. */
  async generateEpicBrief(itemId: string): Promise<EpicBriefJobState> {
    await delay(150);
    const existing = mockEpicBriefJobs.get(itemId);
    if (existing && existing.brief) return existing;
    if (existing && existing.state === "generating") return existing;
    const job: EpicBriefJobState = {
      job_key: `mock:${itemId}`,
      state: "generating",
      error: null,
      brief: null,
    };
    mockEpicBriefJobs.set(itemId, job);
    const timer = setTimeout(() => {
      mockEpicBriefTimers.delete(itemId);
      mockEpicBriefJobs.set(itemId, {
        job_key: job.job_key,
        state: "idle",
        error: null,
        brief: mockEpicBriefFor(itemId),
      });
    }, 1200);
    mockEpicBriefTimers.set(itemId, timer);
    return job;
  }

  async getEpicBrief(itemId: string): Promise<EpicBriefJobState> {
    await delay(150);
    return mockEpicBriefJobs.get(itemId) ?? IDLE_EPIC_BRIEF_JOB(itemId);
  }

  async cancelEpicBrief(itemId: string): Promise<EpicBriefJobState> {
    const timer = mockEpicBriefTimers.get(itemId);
    if (timer) {
      clearTimeout(timer);
      mockEpicBriefTimers.delete(itemId);
    }
    const job: EpicBriefJobState = {
      job_key: `mock:${itemId}`,
      state: "idle",
      error: null,
      brief: null,
    };
    mockEpicBriefJobs.set(itemId, job);
    return job;
  }

  async getEpicBriefOutput(itemId: string): Promise<string[]> {
    await delay(150);
    const job = mockEpicBriefJobs.get(itemId);
    if (!job || job.state !== "generating") return [];
    return ["reading the epic...", "drafting scope and tasks..."];
  }

  async listDiagramTypes(): Promise<DiagramTypeSummary[]> {
    await delay(150);
    return [...mockDiagramTypes.values()].map(({ id, title, description, style }) => ({
      id,
      title,
      description,
      style,
    }));
  }

  // The fixture bridge has no live backend, so subscriptions only fire via the test-facing emit().
  // Each is wired into the shared in-memory bus; only the signatures differ.
  subscribe = (onChange: () => void): (() => void) => this.on("changed", onChange);

  subscribeDiagram(kind: DiagramEventKind, onChange: () => void): () => void {
    return this.on(kind, onChange);
  }

  subscribeDiagramStatus(
    kind: SkillRunKind,
    onChange: (status: DiagramGenerationStatus) => void,
  ): () => void {
    return this.on(`${kind}-status`, onChange);
  }

  subscribeDiagramOutput(kind: SkillRunKind, onLines: (lines: string[]) => void): () => void {
    return this.on(`${kind}-output`, (m: { lines: string[] }) => onLines(m.lines));
  }

  // Reports "not generated yet" so the notice is visible to develop against; Generate then hits the
  // same "not supported in mock mode" path generateDiagram already gives every other kind above.
  async getWikiGeneralStatus(): Promise<WikiGeneralStatus> {
    return { state: "idle", error: null, has_wiki_general: false, stale: false, empty: false };
  }

  async updateWikiGeneral(): Promise<DiagramGenerationStatus> {
    return { state: "error", error: "not supported in mock mode" };
  }

  subscribeTrace = (onChange: () => void): (() => void) => this.on("trace", onChange);

  subscribeTraceStream(onEvent: (message: TraceStreamMessage) => void): () => void {
    return this.on("trace-stream", onEvent);
  }

  subscribeAgents(onEvent: (message: AgentEvent) => void): () => void {
    const unsubscribes = AGENT_EVENT_TYPES.map((type) => this.on<AgentEvent>(type, onEvent));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }
}
