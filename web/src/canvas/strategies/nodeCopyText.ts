import type { HierarchyNodeRef } from "../../state/types";

/** Both id dialects: the real bridge emits `dir::`/`component::`, the fixture mock `folder::`/`file::`. */
const PATH_PREFIXES = ["dir::", "component::", "folder::", "file::"];

/** The shared decode step both copy-text helpers below use: strip a folder/file id's path prefix,
 * or fall back to `label` when `nodeId` is absent (a synthesized node, e.g. a C1 Person/System box),
 * carries no recognized prefix (a symbol id like `function::get_db`, or the `root` sentinel), or
 * decodes to a single bare path segment. That last case covers a coarse C1/pattern/impact block
 * whose authored `path` is a whole top-level directory rather than a real sub-path (e.g. `Control
 * Plane` -> `application`, the repo's biggest folder, before it's been decomposed further) -- a
 * one-segment folder name carries no more information than the label already does, and for a block
 * named something else entirely it actively misleads whoever pastes it as AI context. */
export function elementCopyText(nodeId: string | null, label: string): string {
  if (!nodeId) return label;
  const prefix = PATH_PREFIXES.find((candidate) => nodeId.startsWith(candidate));
  if (!prefix) return label;
  const path = nodeId.slice(prefix.length);
  return path.includes("/") ? path : label;
}

/** What a node's copy button puts on the clipboard: the repo-relative path for a folder or file
 * (decoded from `node_id`, which is `<kind>::<source_path>` in both dialects), the bare name for a
 * symbol or for any synthesized node whose id carries no path. */
export function nodeCopyText(node: HierarchyNodeRef): string {
  if (node.level !== "folder" && node.level !== "file") return node.name;
  return elementCopyText(node.node_id, node.name);
}
