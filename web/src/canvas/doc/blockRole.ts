import type { CanvasElement } from "../../state/types";
import { stringMeta } from "./elementMeta";

export type BlockRole = "component" | "entry" | "data" | "external" | "actor" | "planned";

export const BLOCK_ROLE_LABELS: Record<BlockRole, string> = {
  component: "COMPONENT",
  entry: "ENTRY / API",
  data: "DATA",
  external: "EXTERNAL",
  actor: "ACTOR / CONCEPT",
  planned: "PLANNED",
};

const ROLE_RENDERS = new Set(["c1", "pattern", "impact", "custom"]);
const KIND_ROLES: Record<string, BlockRole> = {
  api: "entry", ui: "entry", client: "entry", entry: "entry",
  database: "data", cache: "data", storage: "data", data: "data",
  external: "external", external_system: "external",
  person: "actor", actor: "actor", concept: "actor",
  planned: "planned",
};
const SHAPE_ROLES: Record<string, BlockRole> = {
  database: "data", storage: "data", cache: "data", data: "data", client: "entry",
  external: "external", actor: "actor", planned: "planned",
};

/** The board role (BlocksAnatomy) of a diagram block, from existing meta only; undefined for non-diagram renders. */
export function blockRoleFor(element: CanvasElement): BlockRole | undefined {
  if (!ROLE_RENDERS.has(element.render)) return undefined;
  const planKind = stringMeta(element, "plan_kind");
  if (planKind === "add" || planKind === "create") return "planned";
  const reason = stringMeta(element, "no_code_reason");
  if (reason === "external") return "external";
  // An authored shape (a store drawn as `storage`) says more than "no code behind it".
  const shape = stringMeta(element, "shape");
  if (shape && shape in SHAPE_ROLES) return SHAPE_ROLES[shape];
  if (reason === "conceptual") return "actor";
  const kind = stringMeta(element, "kind");
  if (kind && kind in KIND_ROLES) return KIND_ROLES[kind];
  if (kind || stringMeta(element, "path") || element.node_id) return "component";
  return undefined;
}

/** The status word beside the role: only when a block is changed, stale or planned. */
export function blockStatusWord(element: CanvasElement, role: BlockRole | undefined, changed: boolean): string | undefined {
  if (role === "planned") return "planned";
  if (stringMeta(element, "stale")) return "stale";
  return changed ? "changed" : undefined;
}
