import type { FunctionDiff } from "./types";
import { expansionStore } from "./expansionState";

/** In diff mode we want the ADDED CODE of each entry visible. A block shows its code panel XOR its
 * child boxes (Block.tsx), so:
 *  - a file/folder container is EXPANDED (not code-shown) — showing its code would hide the class /
 *    function children, so instead we open it and let each child show its own code;
 *  - a class/function shows its source directly via showCode (a class body already contains its
 *    methods as text, so a method-less class like an Enum still renders its added code here).
 * Call after revealNode has expanded the entry's ancestor chain so the block is mounted. */
export function revealDiffEntry(entry: FunctionDiff): void {
  if (entry.level === "file" || entry.level === "folder") {
    expansionStore.expand(entry.node_id);
  } else {
    expansionStore.showCode(entry.node_id);
  }
}
