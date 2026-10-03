import type { CSSProperties } from "react";
import type { HierarchyNodeRef } from "../../../state/types";
import { Block } from "./Block";
import { BLOCK_LAYOUT } from "./layoutConfig";

export interface BoxesRendererProps {
  node: HierarchyNodeRef;
}

/** The hierarchy's renderer — fixed to nested boxes (there is no boxes-vs-tree choice anymore).
 * Wraps `Block` in the strategy-root div that feeds it the block layout sizing vars, exactly as the
 * former `boxesStrategy.NodeRenderer` did. */
export function BoxesRenderer({ node }: BoxesRendererProps) {
  const style = {
    "--block-min-width": `${BLOCK_LAYOUT.minWidth}px`,
    "--block-max-width": `${BLOCK_LAYOUT.maxWidth}px`,
    "--block-min-height": `${BLOCK_LAYOUT.minHeight}px`,
    "--block-child-gap": `${BLOCK_LAYOUT.childGap}px`,
  } as CSSProperties;

  return (
    <div className="boxes-strategy-root" style={style}>
      <Block node={node} />
    </div>
  );
}
