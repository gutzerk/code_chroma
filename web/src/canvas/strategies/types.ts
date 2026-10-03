import type { HierarchyNodeRef } from "../../state/types";

/** The props a hierarchy node renderer (Block, or TreeNode when used as a Block's interior) takes:
 * one node to render. There is no boxes-vs-tree *choice* anymore — the hierarchy always renders as
 * nested boxes — but this shared node shape survives for `Block.ChildRenderer`'s interchangeable use
 * (e.g. the C1 view passing TreeNode into a box's interior). */
export interface CanvasNodeRendererProps {
  node: HierarchyNodeRef;
}
