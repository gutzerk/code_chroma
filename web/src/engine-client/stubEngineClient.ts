import type {
  DiagramPayload,
  DiagramPayloadFor,
  EngineClient,
  SidecarKind,
  SidecarPayload,
} from "./EngineClient";
import {
  EMPTY_IMPACT_CHANGES,
  EMPTY_CANVAS_DOC,
  EMPTY_DIAGRAM,
  type C1Coverage,
  type CanvasBatchResult,
  type CanvasDoc,
  type ChangeCardSet,
  type Diagram,
  type DiagramFetchKind,
  type DiagramGenerationStatus,
  type DiagramLayout,
  type DiagramsStatus,
  type DiagramTypeSummary,
  type EpicBriefJobState,
  type EpicsIndex,
  type EpicWorkItem,
  type WikiGeneralStatus,
} from "../state/types";

export { EMPTY_CANVAS_DOC, EMPTY_DIAGRAM };

/** Inert defaults for the canvas-doc slice (016-single-canvas-dashboard), spread the same way as
 * IMPACT_CHANGES_STUB — a test exercising a different slice needn't stub the canvas too. */
export const CANVAS_STUB = {
  getCanvas: async (): Promise<CanvasDoc> => EMPTY_CANVAS_DOC,
  patchCanvas: async (): Promise<CanvasBatchResult> => ({
    ok: true,
    batch_id: "",
    id_map: {},
    affected: [],
  }),
  subscribeCanvas: (): (() => void) => () => {},
  runRecipe: async (): Promise<CanvasBatchResult> => ({
    ok: true,
    batch_id: "",
    id_map: {},
    affected: [],
  }),
  getDiagramsStatus: async (): Promise<DiagramsStatus> => ({}),
  deleteDiagram: async (): Promise<{ deleted: boolean }> => ({ deleted: true }),
};

/** An empty change-card payload — the shape GET /change-cards returns for a clean tree. */
export const EMPTY_CHANGE_CARDS: ChangeCardSet = {
  base: "HEAD",
  base_resolved: true,
  card_count: 0,
  cards: [],
  by_node: {},
  by_node_status: {},
  unassigned: [],
};

/** No diagram drawn yet — the inert default, so a test that isn't about coverage shows no note. */
export const EMPTY_C1_COVERAGE: C1Coverage = {
  has_diagram: false,
  total_files: 0,
  covered_files: 0,
  unmapped_files: 0,
  percent: 100,
  entries: [],
  truncated: false,
};

const IDLE: DiagramGenerationStatus = { state: "idle", error: null };

const IDLE_WIKI_GENERAL: WikiGeneralStatus = {
  state: "idle",
  error: null,
  has_wiki_general: false,
  stale: false,
  empty: false,
};

/** Inert default for the feature-011 diagram-type library slice — no saved types. Spread the same
 * way as IMPACT_CHANGES_STUB (and folded into it below), so a test that never touches the Diagrams
 * tab needn't declare any of this. The in-app interview that used to author a new type is retired
 * (diagram-management unification); only the library read survives here. */
export const DIAGRAM_TYPE_LIBRARY_STUB = {
  listDiagramTypes: async (): Promise<DiagramTypeSummary[]> => [],
};

/**
 * Inert defaults for the slices of EngineClient a canvas test doesn't exercise: route probing, the
 * Impact change review, the change-card layer, the two skill-run progress feeds, the agent lifecycle
 * channel, and (feature 011) the diagram-type library slice.
 *
 * Spread this into a hand-built stub (`{...IMPACT_CHANGES_STUB, getNode: …}`) so adding a method to one
 * of those slices doesn't mean editing every test file that happens to construct one. Only these
 * slices live here on purpose: the rest of the interface is what those tests are actually testing,
 * and hiding it behind a default would make them assert against methods they never declared.
 */
export const IMPACT_CHANGES_STUB = {
  getRoute: async (): Promise<string[] | null> => null,
  getChangeCards: async (): Promise<ChangeCardSet> => EMPTY_CHANGE_CARDS,
  getSidecar: async <K extends SidecarKind>(kind: K): Promise<SidecarPayload[K]> => {
    const payload: SidecarPayload = {
      changes: EMPTY_IMPACT_CHANGES,
      coverage: EMPTY_C1_COVERAGE,
    };
    return payload[kind];
  },
  subscribeSidecar: (): (() => void) => () => {},
  generateDiagram: async (): Promise<DiagramGenerationStatus> => IDLE,
  getDiagramStatus: async (): Promise<DiagramGenerationStatus> => IDLE,
  cancelDiagram: async (): Promise<DiagramGenerationStatus> => IDLE,
  subscribeDiagram: (): (() => void) => () => {},
  subscribeDiagramStatus: (): (() => void) => () => {},
  getDiagramOutput: async (): Promise<string[]> => [],
  subscribeDiagramOutput: (): (() => void) => () => {},
  getWikiGeneralStatus: async (): Promise<WikiGeneralStatus> => IDLE_WIKI_GENERAL,
  updateWikiGeneral: async (): Promise<DiagramGenerationStatus> => ({ state: "idle", error: null }),
  subscribeAgents: (): (() => void) => () => {},
  ...DIAGRAM_TYPE_LIBRARY_STUB,
  ...CANVAS_STUB,
};

/** An empty C1 payload — the shape GET /c1 normalizes to before a diagram is authored. */
export const EMPTY_C1: Diagram = EMPTY_DIAGRAM;

/** An empty patterns payload — the shape GET /patterns returns before any file has ever been
 * analyzed. */
const EMPTY_PATTERNS: Diagram = EMPTY_DIAGRAM;

/** An empty epics index — the shape GET /epics returns with no requirements source configured. */
const EMPTY_EPICS: EpicsIndex = {
  source: "",
  groups: [],
  items: [],
  omitted: 0,
  generated_at: "",
};

/** One empty payload per fetchable kind — a Record, not a ternary ladder, so a new fixed kind fails
 * to typecheck here instead of silently reusing the last branch's payload. `` `custom/${string}` ``
 * is a whole open-ended family rather than a fixed member, so it's handled by `emptyDiagramFor`
 * below instead of being enumerable here. */
const EMPTY_DIAGRAMS: { [K in "c1" | "patterns" | "impact" | "epics"]: DiagramPayload[K] } = {
  c1: EMPTY_C1,
  patterns: EMPTY_PATTERNS,
  impact: EMPTY_DIAGRAM,
  epics: EMPTY_EPICS,
};

/** `EMPTY_DIAGRAMS` widened to cover every `` `custom/${string}` `` kind too. */
function emptyDiagramFor<K extends DiagramFetchKind>(kind: K): DiagramPayloadFor<K> {
  if (kind.startsWith("custom/")) return EMPTY_DIAGRAM as DiagramPayloadFor<K>;
  return EMPTY_DIAGRAMS[kind as "c1" | "patterns" | "impact" | "epics"] as DiagramPayloadFor<K>;
}

/** Inert defaults for the diagram slice — one stub for every kind now that the client is keyed by
 * one, so a test that only cares about C1 no longer has to name Patterns or Epics as well. Spread
 * it the same way as IMPACT_CHANGES_STUB. */
export const DIAGRAM_STUB = {
  ...IMPACT_CHANGES_STUB,
  getDiagram: async (kind: DiagramFetchKind) => emptyDiagramFor(kind) as never,
  getDiagramLayout: async (): Promise<DiagramLayout> => ({}),
  saveDiagramLayout: async (): Promise<void> => {},
};

/** Kept as an alias so the tests that named the Patterns slice explicitly still read correctly. */
export const PATTERNS_STUB = DIAGRAM_STUB;

/** Inert defaults for the epics slice, spread the same way as IMPACT_CHANGES_STUB. `getEpicsItem`
 * rejects by default — a test exercising a real fetch overrides it explicitly. The index itself
 * now rides the diagram slice (getDiagram("epics") in DIAGRAM_STUB / diagramStub). */
export const EPICS_STUB = {
  getEpicsItem: async (itemId: string): Promise<EpicWorkItem> => {
    throw new Error(`EPICS_STUB: no item stubbed for ${itemId}`);
  },
};

const IDLE_EPIC_BRIEF_JOB: EpicBriefJobState = {
  job_key: "",
  state: "idle",
  error: null,
  brief: null,
};

/** Inert defaults for the epic-brief slice (008-epics-ai-brief), spread the same way as
 * IMPACT_CHANGES_STUB. */
export const EPIC_BRIEF_STUB = {
  generateEpicBrief: async (): Promise<EpicBriefJobState> => IDLE_EPIC_BRIEF_JOB,
  getEpicBrief: async (): Promise<EpicBriefJobState> => IDLE_EPIC_BRIEF_JOB,
  getEpicBriefOutput: async (): Promise<string[]> => [],
  cancelEpicBrief: async (): Promise<EpicBriefJobState> => IDLE_EPIC_BRIEF_JOB,
};

/** A `getDiagram` stub that answers per kind — what a test needs now that one method serves every
 * diagram type. Unnamed kinds fall back to the empty payload, so a C1 test needn't mention
 * Patterns. `custom` is keyed by bare type id (not the `` `custom/${id}` `` kind string) purely for
 * a nicer call site — `diagramStub({ custom: { "data-flow": diagram } })`. The cast is deliberate: a
 * stub answers concrete kinds, the interface is generic. */
export function diagramStub(payloads: {
  c1?: Diagram;
  patterns?: Diagram;
  impact?: Diagram;
  epics?: EpicsIndex;
  custom?: Record<string, Diagram>;
}): EngineClient["getDiagram"] {
  return (async (kind: DiagramFetchKind) => {
    if (kind.startsWith("custom/")) {
      const typeId = kind.slice("custom/".length);
      return payloads.custom?.[typeId] ?? EMPTY_DIAGRAM;
    }
    return payloads[kind as "c1" | "patterns" | "impact" | "epics"] ?? emptyDiagramFor(kind);
  }) as EngineClient["getDiagram"];
}
