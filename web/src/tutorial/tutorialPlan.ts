import { canvasDocStore, patchCanvasDoc } from "../canvas/doc/canvasDocStore";
import type { EngineClient } from "../engine-client/EngineClient";
import type { CanvasElement, CanvasOp } from "../state/types";

const PLAN_LAYER = "patterns";
const PLAN_OFFSET_X = 380;

export interface TutorialFeature {
  id: string;
  label: string;
  service: { name: string; description: string };
  storage: { name: string; description: string };
}

/** The two things the lesson can plan; their code already ships in the tutorial project. */
export const TUTORIAL_FEATURES: readonly TutorialFeature[] = [
  {
    id: "search",
    label: "Search todos",
    service: { name: "search_todos", description: "Finds items whose title has a word." },
    storage: { name: "search", description: "Runs the LIKE query." },
  },
  {
    id: "count",
    label: "Count open todos",
    service: { name: "count_open_todos", description: "Says how many items are not done." },
    storage: { name: "count_open", description: "Counts the rows that are not done." },
  },
];

export function featureById(id: string | null): TutorialFeature | undefined {
  return TUTORIAL_FEATURES.find((feature) => feature.id === id);
}

function byRecipeKey(key: string): CanvasElement | undefined {
  return Object.values(canvasDocStore.getDoc().elements).find(
    (element) => element.layer === PLAN_LAYER && element.meta.recipe_key === key,
  );
}

function featureElements(): CanvasElement[] {
  return Object.values(canvasDocStore.getDoc().elements).filter(
    (element) => element.layer === PLAN_LAYER && element.meta.tutorial_feature !== undefined,
  );
}

/** Takes the feature's blocks off the canvas (a replay, or a different feature picked). */
export async function removePlan(engineClient: EngineClient): Promise<void> {
  const ops: CanvasOp[] = featureElements().map((element) => ({
    op: "delete_element",
    id: element.id,
  }));
  if (ops.length > 0) await patchCanvasDoc(engineClient, ops, { layer: PLAN_LAYER });
}

/** Draws the feature as a plan: two dashed "add" blocks wired into the patterns diagram. */
export async function drawPlan(
  engineClient: EngineClient,
  feature: TutorialFeature,
): Promise<void> {
  await removePlan(engineClient);
  const handlers = byRecipeKey("infra::handlers");
  const facade = byRecipeKey("facade::todo_service");
  const repository = byRecipeKey("repository::todo_repository");
  const sqlite = byRecipeKey("ext::sqlite");
  if (!handlers || !facade || !repository || !sqlite) return;
  const block = (
    tempId: string,
    spec: { name: string; description: string },
    role: string,
    parent: string,
    position: { x: number; y: number },
  ): CanvasOp => ({
    op: "add_element",
    temp_id: tempId,
    render: "pattern",
    label: spec.name,
    description: spec.description,
    node_id: null,
    position,
    created_by: "ai",
    meta: {
      role,
      parent,
      recipe_key: `plan::${tempId}`,
      plan_kind: "add",
      no_code_reason: "planned",
      tutorial_feature: feature.id,
    },
  });
  const ops: CanvasOp[] = [
    block("service", feature.service, "facade", "facade::todo_service", {
      x: facade.position.x + PLAN_OFFSET_X,
      y: facade.position.y,
    }),
    block("storage", feature.storage, "implementation", "repository::todo_repository", {
      x: repository.position.x + PLAN_OFFSET_X,
      y: repository.position.y,
    }),
    { op: "add_edge", from: handlers.id, to: "service", kind: "uses", label: "calls" },
    { op: "add_edge", from: "service", to: "storage", kind: "uses", label: "uses" },
    { op: "add_edge", from: "storage", to: sqlite.id, kind: "uses", label: "queries" },
  ];
  await patchCanvasDoc(engineClient, ops, { layer: PLAN_LAYER });
}

/** Turns the planned blocks into real code: the agent has written the functions they stand for. */
export async function buildPlan(engineClient: EngineClient, feature: TutorialFeature): Promise<void> {
  const ops: CanvasOp[] = featureElements().map((element) => {
    const isService = element.meta.recipe_key === "plan::service";
    const file = isService ? "backend/service.py" : "db/repository.py";
    const name = isService ? feature.service.name : feature.storage.name;
    return {
      op: "update_element",
      id: element.id,
      node_id: `${file}::function::${name}`,
      meta: { plan_kind: null, no_code_reason: null },
    };
  });
  if (ops.length > 0) await patchCanvasDoc(engineClient, ops, { layer: PLAN_LAYER });
}
