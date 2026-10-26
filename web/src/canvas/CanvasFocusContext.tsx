import { createContext, useContext } from "react";

const noop = () => {};

/** Lets any nested Block trigger "center + fill screen" on itself without prop-drilling a
 * callback through every level of the recursive Block tree. */
export const CanvasFocusContext = createContext<(nodeId: string) => void>(noop);

export function useCanvasFocus(): (nodeId: string) => void {
  return useContext(CanvasFocusContext);
}

/** Centres and fits the view on one diagram layer's frame (`data-diagram-layer`), false when absent. */
export const CanvasDiagramFocusContext = createContext<(layer: string) => boolean>(() => false);

export function useCanvasDiagramFocus(): (layer: string) => boolean {
  return useContext(CanvasDiagramFocusContext);
}
