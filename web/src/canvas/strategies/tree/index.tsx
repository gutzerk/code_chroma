import type { CSSProperties } from "react";
import type { CanvasNodeRendererProps, CanvasRenderStrategy } from "../types";
import { TreeNode } from "./TreeNode";
import { TREE_LAYOUT } from "./layoutConfig";

function TreeNodeRenderer({ node }: CanvasNodeRendererProps) {
  const style = {
    "--tree-indent": `${TREE_LAYOUT.indent}px`,
    "--tree-row-gap": `${TREE_LAYOUT.rowGap}px`,
  } as CSSProperties;

  return (
    <div className="tree-strategy-root" style={style}>
      <TreeNode node={node} />
    </div>
  );
}

export const treeStrategy: CanvasRenderStrategy = {
  id: "tree",
  label: "Tree",
  NodeRenderer: TreeNodeRenderer,
};
