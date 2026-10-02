import type { CSSProperties } from "react";
import type { CanvasNodeRendererProps, CanvasRenderStrategy } from "../types";
import { Block } from "./Block";
import { BLOCK_LAYOUT } from "./layoutConfig";

function BoxesNodeRenderer({ node }: CanvasNodeRendererProps) {
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

export const boxesStrategy: CanvasRenderStrategy = {
  id: "boxes",
  label: "Nested Boxes",
  NodeRenderer: BoxesNodeRenderer,
};
