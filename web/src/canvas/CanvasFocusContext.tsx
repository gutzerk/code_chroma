import { createContext, useContext } from "react";

const noop = () => {};

/** Lets any nested Block trigger "center + fill screen" on itself without prop-drilling a
 * callback through every level of the recursive Block tree. */
export const CanvasFocusContext = createContext<(nodeId: string) => void>(noop);

export function useCanvasFocus(): (nodeId: string) => void {
  return useContext(CanvasFocusContext);
}
