import { diagramAccent } from "./diagramDisplay";

/** Resolves a diagram layer key to its frame's colour class; delegates to the one source in `diagramDisplay.ts`. */
export function diagramFrameColorClass(layer: string): string {
  return diagramAccent(layer).className;
}
