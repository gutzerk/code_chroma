import { createContext, useContext } from "react";

const noop = () => {};

/** Lets any nested Block trigger "center + fill screen" on itself without prop-drilling a
 * callback through every level of the recursive Block tree. */
export const CanvasFocusContext = createContext<(nodeId: string) => void>(noop);

export function useCanvasFocus(): (nodeId: string) => void {
  return useContext(CanvasFocusContext);
}

/** Shows one diagram layer if hidden, then fits the view on its frame (`data-diagram-layer`) once it mounts. */
export const CanvasDiagramFocusContext = createContext<(layer: string) => void>(noop);

export function useCanvasDiagramFocus(): (layer: string) => void {
  return useContext(CanvasDiagramFocusContext);
}
