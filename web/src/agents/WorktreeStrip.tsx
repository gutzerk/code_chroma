import { memo, useCallback, useState } from "react";
import type { WorktreeRecord } from "../state/types";
import { messageOf } from "../util/reportError";
import type { AgentClient } from "./agentClient";
import { useAgentClient } from "./AgentClientContext";
import { useActiveWorkspace } from "./agentStore";
import { CloseWorktreeDialog } from "./CloseWorktreeDialog";
import { getRememberedCloseChoice, type CloseChoice } from "./closeChoice";
import { closeWorktree, createWorktree, refreshWorktrees, renameWorktree, selectWorktree } from "./worktreeActions";
import { useActiveWorktreeId, useWorktreeCreating, useWorktrees, useWorktreeWarning } from "./worktreeStore";

interface TabProps {
  client: AgentClient;
  tab: WorktreeRecord;
  selected: boolean;
  editing: boolean;
  renameError: string | null;
  onStartRename: (id: string) => void;
  onCommit: (id: string, name: string, value: string) => void;
  onCancelRename: () => void;
  onRequestClose: (id: string) => void;
}

const WorktreeTab = memo(function WorktreeTab({
  client,
  tab,
  selected,
  editing,
  renameError,
  onStartRename,
  onCommit,
  onCancelRename,
  onRequestClose,
}: TabProps) {
  return (
    <div className={`worktree-tab${selected ? " is-active" : ""}`} data-testid={`worktree-tab-${tab.id}`}>
      {editing ? (
        <input
          className="worktree-rename"
          data-testid="worktree-rename-input"
          aria-label={`Rename ${tab.name}`}
          defaultValue={tab.name}
          autoFocus
          onBlur={(event) => onCommit(tab.id, tab.name, event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommit(tab.id, tab.name, event.currentTarget.value);
            else if (event.key === "Escape") onCancelRename();
          }}
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={selected}
          className="worktree-tab-label"
          title={tab.worktree_lost ? `${tab.name} (worktree missing)` : tab.name}
          onClick={() => selectWorktree(client, tab.id)}
          onDoubleClick={() => onStartRename(tab.id)}
        >
          {tab.name}
        </button>
      )}
      <button
        type="button"
        className="worktree-tab-close"
        aria-label={`Close ${tab.name}`}
        data-testid={`worktree-close-${tab.id}`}
        onClick={() => onRequestClose(tab.id)}
      >
        ×
      </button>
      {editing && renameError && (
        <span className="worktree-error" role="alert" data-testid="worktree-rename-error">
          {renameError}
        </span>
      )}
    </div>
  );
});

/** The worktree tabs of the open project: one per `br_*` record, "+" for a new one off the refreshed
 * default branch, double-click to rename (a 409 shows inline), "x" to close through the keep/delete dialog. */
export function WorktreeStrip() {
  const client = useAgentClient();
  const tabs = useWorktrees();
  const activeTab = useActiveWorktreeId();
  const workspace = useActiveWorkspace();
  const creating = useWorktreeCreating();
  const warning = useWorktreeWarning();
  const [editing, setEditing] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const closingTab = tabs.find((tab) => tab.id === closing);

  const startRename = useCallback((id: string) => {
    setEditing(id);
    setRenameError(null);
  }, []);

  const cancelRename = useCallback(() => setEditing(null), []);

  const commitRename = useCallback(
    async (id: string, name: string, value: string) => {
      const next = value.trim();
      if (!next || next === name) {
        setEditing(null);
        return;
      }
      try {
        await renameWorktree(client, id, next);
        setEditing(null);
        setRenameError(null);
      } catch (err) {
        setRenameError(messageOf(err));
      }
    },
    [client],
  );

  const requestClose = useCallback(
    (id: string) => {
      const remembered = getRememberedCloseChoice();
      if (remembered) {
        void closeWorktree(client, id, remembered === "delete").catch(() => {
          // A remembered choice that fails falls back to the dialog, which shows the refusal.
          setClosing(id);
        });
        return;
      }
      void refreshWorktrees(client).catch(() => {
        // The dialog falls back to the counts it already has.
      });
      setClosing(id);
    },
    [client],
  );

  return (
    <div className="worktree-strip" data-testid="worktree-strip" role="tablist" aria-label="Worktrees">
      {tabs.map((tab) => (
        <WorktreeTab
          key={tab.id}
          client={client}
          tab={tab}
          selected={tab.id === (activeTab ?? workspace)}
          editing={editing === tab.id}
          renameError={editing === tab.id ? renameError : null}
          onStartRename={startRename}
          onCommit={commitRename}
          onCancelRename={cancelRename}
          onRequestClose={requestClose}
        />
      ))}
      <button
        type="button"
        className="worktree-add"
        aria-label="New worktree"
        data-testid="worktree-add"
        aria-busy={creating}
        disabled={creating}
        onClick={() => void createWorktree(client)}
      >
        {creating ? "…" : "+"}
      </button>
      {warning && (
        <span className="worktree-warning" role="status" data-testid="worktree-warning">
          {warning}
        </span>
      )}
      {closingTab && (
        <CloseWorktreeDialog
          id={closingTab.id}
          name={closingTab.name}
          dirty={closingTab.dirty ?? 0}
          onCancel={() => setClosing(null)}
          onConfirm={async (choice: CloseChoice) => {
            await closeWorktree(client, closingTab.id, choice === "delete");
            setClosing(null);
          }}
        />
      )}
    </div>
  );
}
