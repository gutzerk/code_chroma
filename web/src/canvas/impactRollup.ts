import { changeRecordsOf } from "../state/useSidecar";
import { containerPathOf } from "./strategies/nodeCopyText";
import type { ImpactBlockChange, ImpactChangedFile, ImpactChangeStatus, ImpactChanges } from "../state/types";

/** What the inspector shows for one Impact box: its (rolled-up) change and the reviewed boxes inside it. */
export interface ImpactRollup {
  change: ImpactBlockChange;
  nested: ImpactBlockChange[];
}

const SYMBOL_SEPARATORS = ["::function::", "::class::", "::method::", "::functions"];

/** The file a symbol or container node id lives in (`F::function::x`, `service::F::functions`), or null. */
export function filePartOf(nodeId: string): string | null {
  const id = nodeId.startsWith("service::") ? nodeId.slice("service::".length) : nodeId;
  const at = SYMBOL_SEPARATORS.map((sep) => id.indexOf(sep)).filter((i) => i > 0);
  return at.length > 0 ? id.slice(0, Math.min(...at)) : null;
}

/** The repo path a graph node id stands for (`dir::P`, `component::F`, `F::function::x`), or null. */
export function pathOfNodeId(nodeId: string): string | null {
  return containerPathOf(nodeId) ?? filePartOf(nodeId);
}

function isUnder(path: string | null | undefined, scope: string): boolean {
  if (path == null) return false;
  return scope === "" || path === scope || path.startsWith(`${scope}/`);
}

/** Same rule as the bridge's ImpactChanges.StatusFor: added/removed only when every file agrees. */
function statusOf(files: ImpactChangedFile[]): ImpactChangeStatus {
  if (files.length === 0) return "modified";
  if (files.every((file) => file.status === "added")) return "added";
  if (files.every((file) => file.status === "deleted")) return "removed";
  return "modified";
}

/** Files with each path listed once, first entry wins. */
export function uniqueByPath(files: readonly ImpactChangedFile[]): ImpactChangedFile[] {
  const seen = new Map<string, ImpactChangedFile>();
  for (const file of files) if (!seen.has(file.path)) seen.set(file.path, file);
  return [...seen.values()];
}

/** Rolls every change under a directory/file box into its inspector view: the bridge pins each changed file only on its nearest box, so a folder box holding smaller boxes has no files of its own. */
export function rollupImpactChange(
  changes: ImpactChanges,
  nodeId: string,
  recipeKey?: string,
): ImpactRollup | undefined {
  const records = changeRecordsOf(changes);
  const own =
    (recipeKey ? records.find((record) => record.node_id === recipeKey) : undefined) ??
    records.find((record) => record.node_id === nodeId);
  const ownOnly = own && { change: own, nested: [] };
  const scope = containerPathOf(nodeId);
  if (scope === null) return ownOnly;

  const nested = records.filter(
    (record) =>
      record !== own &&
      (isUnder(record.path ?? pathOfNodeId(record.node_id), scope) ||
        record.files.some((file) => isUnder(file.path, scope))),
  );
  const extraFiles = [...nested.flatMap((record) => record.files), ...changes.unassigned].filter((file) =>
    isUnder(file.path, scope),
  );
  if (nested.length === 0 && extraFiles.length === 0) return ownOnly;

  const id = recipeKey ?? nodeId;
  const files = uniqueByPath([...(own?.files ?? []), ...extraFiles]);
  const change: ImpactBlockChange = {
    block: id,
    node_id: id,
    name: "",
    path: scope,
    before: "",
    after: "",
    explanation: "",
    ...own,
    status: own?.status ?? statusOf(files),
    files,
    change_count: files.length,
    pr_comments: [
      ...(own?.pr_comments ?? []),
      ...nested.flatMap((record) => record.pr_comments),
      ...changes.general_pr_comments.filter((comment) => isUnder(comment.path, scope)),
    ],
  };
  return { change, nested };
}
