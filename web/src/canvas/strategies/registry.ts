import type { CanvasRenderStrategy } from "./types";
import { boxesStrategy } from "./boxes";
import { treeStrategy } from "./tree";

const DEFAULT_STRATEGY_ID = "tree";

const strategies: Record<string, CanvasRenderStrategy> = {
  boxes: boxesStrategy,
  tree: treeStrategy,
};

/** Unknown or unset id falls back to the default strategy rather than throwing. */
export function resolveStrategy(id: string | undefined): CanvasRenderStrategy {
  return (id ? strategies[id] : undefined) ?? strategies[DEFAULT_STRATEGY_ID];
}
