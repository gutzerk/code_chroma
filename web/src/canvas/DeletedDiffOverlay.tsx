import { DiffView } from "./DiffView";
import { leafNodeRef } from "./leafNodeRef";
import { useDeletedDiffs } from "../state/diffOverlayStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { useAcceptDiff } from "../state/useAcceptDiff";
import { useIsWorkspaceReadOnly } from "../agents/workspaceStore";
import type { EngineClient } from "../engine-client/EngineClient";
import type { FunctionDiff } from "../state/types";

/** One floating panel — its own component so each gets an independent useAcceptDiff instance
 * instead of the overlay tracking every panel's accepting/error state in a shared map. */
function DeletedDiffItem({ diff, engineClient }: { diff: FunctionDiff; engineClient: EngineClient }) {
  const { handleAccept, isAccepting, acceptError } = useAcceptDiff(engineClient);
  // Same gate as NodePanels: a deleted-function panel in a read-only workspace offers no Accept.
  const readOnly = useIsWorkspaceReadOnly();
  return (
    <DiffView
      node={leafNodeRef(diff.node_id, diff.name ?? diff.node_id, "function", "python")}
      diff={diff}
      deleted
      draggable
      onAccept={readOnly ? undefined : handleAccept}
      isAccepting={isAccepting}
      acceptError={acceptError}
    />
  );
}

/** Floating stack of blurred panels for functions deleted vs HEAD, shown only while diff mode is
 * active. Each panel is keyed by node_id so a deletion that persists across live updates stays put
 * (never re-mounted or repositioned), matching the "don't move an already-open window" rule. */
export function DeletedDiffOverlay() {
  const deleted = useDeletedDiffs();
  const engineClient = useEngineClient();

  if (deleted.length === 0) return null;

  return (
    <div className="deleted-diff-overlay" data-testid="deleted-diff-overlay">
      {deleted.map((diff) => (
        <DeletedDiffItem key={diff.node_id} diff={diff} engineClient={engineClient} />
      ))}
    </div>
  );
}
