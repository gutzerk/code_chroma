import { useState } from "react";
import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { useDisclosureMenu } from "../util/useDisclosureMenu";
import { useAgentClient } from "./AgentClientContext";
import { switchBranch, updateCurrentBranch } from "./branchActions";
import { branchStore, useBranchError, useBranches, useCurrentBranch } from "./branchStore";
import { ModalDialog } from "./ModalDialog";

/** PyCharm-style branch switcher: shows main's current branch, updates it (git pull --ff-only) and
 * checks out another local one on click — a real `git checkout`, refused (via a blocking modal, not
 * a silent no-op or easy-to-miss inline line) over uncommitted changes. It works from any
 * workspace, including an agent's: only main's own tree is ever checked out, and an agent's worktree
 * is untouched by that, so being focused on an agent is no reason to refuse. Branches another
 * worktree holds never reach the list — the bridge already filters them
 * (`main_branch.switchable_branches`). */
export function BranchSwitcher() {
  const agentClient = useAgentClient();
  const current = useCurrentBranch();
  const branches = useBranches();
  const error = useBranchError();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"switch" | "update" | null>(null);
  const busy = action !== null;
  const { containerRef, triggerRef, onListKeyDown } = useDisclosureMenu(open, () => setOpen(false));

  // Opened, not mounted: another window (or a plain `git checkout` in a terminal) can create or
  // delete a branch between opens, so the list is re-read from the bridge every time it's shown
  // rather than trusting whatever mount-time snapshot is still sitting in branchStore. The fetch
  // lives in the event handler, not inside the setState updater — an updater must stay pure (React
  // may call it more than once), and a side effect there is not guaranteed to run on every open.
  const onToggle = () => {
    const opening = !open;
    if (opening) {
      void agentClient
        .getBranch()
        .then(branchStore.setBranch)
        .catch(() => {
          // A stale list is better than none; the dropdown still opens with what it already had.
        });
    }
    setOpen(!open);
  };

  const run = async (kind: "switch" | "update", fn: () => Promise<unknown>) => {
    if (busy) return;
    setAction(kind);
    try {
      await fn();
    } finally {
      setAction(null);
      setOpen(false);
    }
  };

  const switchTo = (branch: string) => {
    if (branch === current || busy) return;
    void run("switch", () => switchBranch(agentClient, branch));
  };

  return (
    <div className="branch-switcher" ref={containerRef}>
      <RailButton
        ref={triggerRef}
        className="branch-switcher-button"
        testId="branch-switcher-button"
        label={current ? `Branch: ${current}` : "Switch branch"}
        tooltip={current ? `Branch: ${current}` : "Switch branch"}
        ariaExpanded={open}
        onClick={onToggle}
      >
        <RailIcon name="branch" />
      </RailButton>
      <span className="branch-switcher-name" data-testid="branch-switcher-name">
        {current ?? ""}
      </span>
      {open && (
        <ul
          className="branch-switcher-list"
          data-testid="branch-switcher-list"
          onKeyDown={onListKeyDown}
        >
          <li>
            <button
              type="button"
              className="branch-switcher-update"
              data-testid="branch-switcher-update"
              disabled={busy || !current}
              onClick={() => void run("update", () => updateCurrentBranch(agentClient))}
            >
              Update
            </button>
          </li>
          {branches.map((branch) => (
            <li key={branch}>
              <button
                type="button"
                className="branch-switcher-item"
                aria-current={branch === current}
                disabled={busy}
                onClick={() => switchTo(branch)}
              >
                {branch}
              </button>
            </li>
          ))}
          {branches.length === 0 && <li className="branch-switcher-empty">No local branches</li>}
        </ul>
      )}
      {error && (
        <ModalDialog
          testId="branch-switcher-error-dialog"
          label={action === "update" ? "Branch update failed" : "Branch switch failed"}
          onDismiss={() => branchStore.setError(null)}
        >
          <h2 className="agent-dialog-title">
            {action === "update" ? "Can’t update branch" : "Can’t switch branch"}
          </h2>
          <p className="agent-dialog-error">{error}</p>
          <div className="agent-dialog-actions">
            <button
              type="button"
              className="agent-dialog-primary"
              onClick={() => branchStore.setError(null)}
            >
              OK
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
