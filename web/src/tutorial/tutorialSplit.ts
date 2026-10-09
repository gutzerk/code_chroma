import { canvasDocStore, patchCanvasDoc } from "../canvas/doc/canvasDocStore";
import type { EngineClient } from "../engine-client/EngineClient";
import type { CanvasOp } from "../state/types";

const LAYER = "impact";
const ADD_TODO = "backend/service.py::function::add_todo";
const INSERT = "db/repository.py::function::insert";
const COLUMN_GAP = 400;
const ROW_GAP = 240;

/** Splits the impact diagram's add_todo block into three numbered steps, the way an agent would. */
export async function splitAddTodo(engineClient: EngineClient): Promise<void> {
  const doc = canvasDocStore.getDoc();
  const blocks = Object.values(doc.elements).filter((element) => element.layer === LAYER);
  const original = blocks.find((element) => element.node_id === ADD_TODO);
  if (!original) return;
  const column = Math.max(...blocks.map((element) => element.position.x)) + COLUMN_GAP;
  const insert = blocks.find((element) => element.node_id === INSERT);
  const saveEdges = Object.values(doc.edges).filter(
    (edge) => edge.from === original.id && edge.to === insert?.id,
  );
  const step = (
    tempId: string,
    label: string,
    description: string,
    order: string,
    y: number,
  ): CanvasOp => ({
    op: "add_element",
    temp_id: tempId,
    render: "impact",
    label,
    description,
    node_id: ADD_TODO,
    position: { x: column, y },
    created_by: "ai",
    meta: { status: "modified", order, recipe_key: `split::${tempId}` },
  });
  const ops: CanvasOp[] = [
    {
      op: "update_element",
      id: original.id,
      label: "add_todo: check the title",
      description: "Step 1. Asks validate_title to reject an empty title.",
      meta: { order: "1", recipe_key: "split::check" },
    },
    step("save", "add_todo: save", "Step 2. Writes the todo to SQLite through insert.", "2", original.position.y),
    step("return", "add_todo: return", "Step 3. Gives the saved todo back to the caller.", "3", original.position.y + ROW_GAP),
    ...saveEdges.map((edge): CanvasOp => ({ op: "delete_edge", id: edge.id })),
    { op: "add_edge", from: original.id, to: "save", kind: "uses", label: "then" },
    { op: "add_edge", from: "save", to: "return", kind: "uses", label: "then" },
  ];
  if (insert) ops.push({ op: "add_edge", from: "save", to: insert.id, kind: "uses", label: "saves" });
  await patchCanvasDoc(engineClient, ops, { layer: LAYER });
}
