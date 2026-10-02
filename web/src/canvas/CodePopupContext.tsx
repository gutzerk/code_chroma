import { createContext, useContext } from "react";
import type { HierarchyNodeRef } from "../state/types";

const noop = () => {};

/** Lets any nested Block/TreeNode open the code popup for itself without prop-drilling a
 * callback through every level of the recursive render tree. */
export const CodePopupContext = createContext<(node: HierarchyNodeRef) => void>(noop);

export function useCodePopup(): (node: HierarchyNodeRef) => void {
  return useContext(CodePopupContext);
}
