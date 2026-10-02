import { useState } from "react";
import type { GitPreflight } from "../state/types";
import { useAgentClient } from "./AgentClientContext";
import { ModalDialog } from "./ModalDialog";

/** Agents need git to work in isolated copies, and `git worktree add` is impossible without a real
 * first commit — so on a fresh folder this dialog shows exactly what would enter history before
 * anything runs. Every suspicious path is pre-ticked, so the common case is pressing Create. */
export function GitInitDialog({
  preflight,
  onReady,
  onDismiss,
}: {
  preflight: GitPreflight;
  onReady: () => void;
  onDismiss: () => void;
}) {
  const agentClient = useAgentClient();
  const plan = preflight.plan;
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (path: string) => {
    setUnticked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const ticked = (plan?.suspicious ?? [])
        .map((entry) => entry.path)
        .filter((path) => !unticked.has(path));
      await agentClient.gitInit(ticked);
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      testId="git-init-dialog"
      label="Enable agents"
      className="agent-dialog-wide"
      onDismiss={busy ? undefined : onDismiss}
    >
      <h2 className="agent-dialog-title">Agents need git to work in isolated copies</h2>
      {preflight.state === "nested" ? (
        <p className="agent-dialog-body">
          This project is inside the repository <code>{preflight.parent_repo}</code>. Open that root
          instead — a repository nested inside another is almost always a mistake.
        </p>
      ) : preflight.state === "no-git" ? (
        <p className="agent-dialog-body">
          git is not installed, so there is nothing this app can do from here. Install git and reopen
          the project.
        </p>
      ) : (
        <>
          <ol className="agent-dialog-steps">
            <li>
              <code>git init</code>
              {preflight.state === "no-commits" && " — already done"}
            </li>
            <li>
              create <code>.gitignore</code> (only if you don’t already have one)
            </li>
            <li>
              <code>git add -A</code>
            </li>
            <li>
              <code>git commit</code>
            </li>
          </ol>
          <p className="agent-dialog-body" data-testid="git-init-summary">
            {plan?.file_count ?? 0} file{(plan?.file_count ?? 0) === 1 ? "" : "s"},{" "}
            {formatBytes(plan?.total_bytes ?? 0)} would enter the first commit.
          </p>
          {(plan?.suspicious.length ?? 0) > 0 && (
            <div className="agent-dialog-suspicious">
              <p className="agent-dialog-body">Excluded unless you say otherwise:</p>
              <ul>
                {plan?.suspicious.map((entry) => (
                  <li key={entry.path}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!unticked.has(entry.path)}
                        onChange={() => toggle(entry.path)}
                      />
                      <code>{entry.path}</code>
                      <span className="agent-dialog-reason">
                        {entry.reason}
                        {entry.already_ignored && " · already ignored"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {error && <p className="agent-dialog-error">{error}</p>}
      <div className="agent-dialog-actions">
        <button type="button" onClick={onDismiss} disabled={busy}>
          Cancel
        </button>
        {preflight.state !== "nested" && (
          <button
            type="button"
            className="agent-dialog-primary"
            onClick={() => void create()}
            disabled={busy || preflight.state === "no-git"}
          >
            {preflight.state === "no-git" ? "Install git" : "Create repository and first commit"}
          </button>
        )}
      </div>
    </ModalDialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
