import type { EngineClient } from "../engine-client/EngineClient";
import type { HierarchyNodeRef } from "../state/types";
import { openFilesStore } from "./openFilesStore";

/** Parses an edge `origin` (`file:line`) into its parts, or null when it isn't that shape. */
export function parseOrigin(origin: string): { path: string; line: number } | null {
  const idx = origin.lastIndexOf(":");
  if (idx <= 0 || idx === origin.length - 1) return null;
  const path = origin.slice(0, idx);
  const line = Number(origin.slice(idx + 1));
  if (!Number.isInteger(line) || line <= 0) return null;
  return { path, line };
}

/** Opens the code at an edge's `origin` (`file:line`) in the code sidebar.
 *
 * The edge carries only the caller's `file:line` (provenance), not a graph node id, so we fetch the
 * source slice by path and open a synthetic ref — the sidebar/CodeView then renders it exactly like
 * any opened file, with the label named `<file>:<line>`. A path with no slice stays closed. */
export async function openOrigin(
  origin: string,
  client: EngineClient,
): Promise<void> {
  const parsed = parseOrigin(origin);
  if (!parsed) return;
  // A stale/renamed-file origin is an everyday miss (the caller's provenance goes out of date), so
  // a 404 or network failure must never surface as an unhandled rejection to the click handler.
  let fragment;
  try {
    fragment = await client.getSourceFragment?.(parsed.path, {
      start: Math.max(parsed.line - 2, 1),
      end: parsed.line + 2,
    });
  } catch {
    return;
  }
  if (!fragment || !fragment.content) return;
  const ref: HierarchyNodeRef = {
    node_id: `origin:${origin}`,
    name: `${parsed.path}:${parsed.line}`,
    level: "function",
    parent_id: null,
    has_children: false,
    child_count: 0,
    source: fragment.content,
    language: fragment.language ?? undefined,
  };
  openFilesStore.open(ref);
}
