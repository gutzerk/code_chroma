import { useCallback, useEffect, useMemo, useState } from "react";
import type { GithubOpenPr, PrImportPreflight, PrWorkspace } from "../state/types";
import { useAgentClient } from "../agents/AgentClientContext";
import { ModalDialog } from "../agents/ModalDialog";
import { agentStore, useActiveWorkspace } from "../agents/agentStore";
import { getDesktopWorkspaceApi } from "../agents/desktopWorkspaceApi";
import { workspaceStore } from "../agents/workspaceStore";
import { prStore, usePrWorkspaces } from "./prStore";

/** Pick one of GitHub's open pull requests, get it on the canvas as a read-only workspace.
 *
 * Blockers render as a disabled primary button *with the reason as its label*, checked before the
 * click rather than surfaced after it. Only ref-specific and network failures are post-click errors,
 * because only those can't be known in advance. */
export function PrDialog({ onDismiss }: { onDismiss: () => void }) {
  const agentClient = useAgentClient();
  const prs = usePrWorkspaces();
  const activeWorkspace = useActiveWorkspace();
  const [preflight, setPreflight] = useState<PrImportPreflight | null>(null);
  const [githubPrs, setGithubPrs] = useState<GithubOpenPr[] | null>(null);
  const [githubPrsError, setGithubPrsError] = useState<string | null>(null);
  const [selectedNumber, setSelectedNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 🔴 One PR's last refresh outcome. Without it Refresh is silent: the row renders none of the
  // fields a refresh can change (fetched_at, head_sha, changed_files, additions, deletions), so
  // "pulled new commits" and "already up to date" looked identical — the button read as broken.
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    agentClient
      .prImportPreflight()
      .then((next) => {
        if (!cancelled) setPreflight(next);
      })
      .catch(() => {
        if (!cancelled) setPreflight({ ready: false, reason: "unavailable", text: "No bridge" });
      });
    return () => {
      cancelled = true;
    };
  }, [agentClient]);

  useEffect(() => {
    let cancelled = false;
    agentClient
      .listGithubPrs()
      .then((next) => {
        if (!cancelled) setGithubPrs(next);
      })
      .catch((err) => {
        if (!cancelled) setGithubPrsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [agentClient]);

  const refreshList = useCallback(async () => {
    const list = await agentClient.listPrs();
    prStore.setList(list.prs);
  }, [agentClient]);

  // Already-imported PRs are managed via the list below, so the picker only offers the rest.
  const importedNumbers = useMemo(() => new Set(prs.map((pr) => pr.number)), [prs]);
  const availablePrs = (githubPrs ?? []).filter((pr) => !importedNumbers.has(pr.number));
  const parsed = selectedNumber ? Number(selectedNumber) : null;

  const open = async () => {
    if (parsed === null) return;
    setBusy(true);
    setError(null);
    try {
      const pr = await agentClient.openPr(String(parsed));
      prStore.upsert(pr);
      setSelectedNumber("");
      if (getDesktopWorkspaceApi()) {
        // Desktop: open the PR as its own tab, keeping the current repo tab's place intact (a bare
        // window would lose the tab bar) -- the desktop half focuses that new tab.
        onDismiss();
        try {
          await getDesktopWorkspaceApi()?.openWorkspaceWindow(pr.id);
        } catch {
          // Best-effort tab open; the PR is already imported and listed either way.
        }
      } else {
        await activate(pr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (pr: PrWorkspace) => {
    // Optimistic: the canvas switches before the analyze lands.
    agentStore.setActiveWorkspace(pr.id);
    try {
      workspaceStore.setStatus(await agentClient.activateWorkspace(pr.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const refresh = async (pr: PrWorkspace) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await agentClient.refreshPr(pr.number);
      prStore.upsert(updated);
      // `updated` is the route's own "the head moved" flag (routes/prs.py's refresh_pr), not a guess
      // from comparing payloads — it is what decides whether the workspace was dropped and re-seeded.
      const head = updated.head_sha.slice(0, 7);
      setNotice({
        id: updated.id,
        text: updated.updated
          ? `Updated${head ? ` to ${head}` : ""}`
          : "Already up to date",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const close = async (pr: PrWorkspace) => {
    setBusy(true);
    setError(null);
    try {
      await agentClient.closePr(pr.number);
      prStore.remove(pr.id);
      // agentStore.remove only resets the active id for *agent* ids, so a PR must do it itself.
      if (activeWorkspace === pr.id) {
        agentStore.setActiveWorkspace("main");
        workspaceStore.setStatus(await agentClient.activateWorkspace("main"));
      }
      // Best-effort: closes a stray "Open in New Window" copy so it doesn't outlive its workspace.
      void getDesktopWorkspaceApi()?.closeWorkspaceWindow(pr.id);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const blocked = preflight !== null && !preflight.ready;
  const primaryLabel = primaryText(preflight, busy);

  return (
    <ModalDialog
      testId="pr-dialog"
      label="Review a GitHub pull request"
      className="agent-dialog-wide"
      onDismiss={busy ? undefined : onDismiss}
    >
      <h2 className="agent-dialog-title">Review a pull request on the canvas</h2>
      <p className="agent-dialog-body">
        Its head is fetched into a read-only copy beside your work — nothing is committed, and no
        branch is created.
      </p>
      <div className="pr-dialog-input-row">
        <select
          className="pr-dialog-select"
          data-testid="pr-dialog-select"
          aria-label="Open pull request on GitHub"
          value={selectedNumber}
          disabled={busy || blocked || availablePrs.length === 0}
          onChange={(event) => setSelectedNumber(event.target.value)}
        >
          <option value="">{selectPlaceholder(githubPrs, githubPrsError, availablePrs.length)}</option>
          {availablePrs.map((pr) => (
            <option key={pr.number} value={pr.number}>
              #{pr.number} · {pr.title}
              {pr.head_ref ? ` (${pr.head_ref})` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="agent-dialog-primary"
          data-testid="pr-dialog-open"
          disabled={busy || blocked || parsed === null}
          title={preflight?.reason ?? undefined}
          onClick={() => void open()}
        >
          {primaryLabel}
        </button>
      </div>
      {githubPrsError && (
        <p className="agent-dialog-error" data-testid="pr-dialog-github-error">
          Couldn't load GitHub's open pull requests: {githubPrsError}
        </p>
      )}
      {error && (
        <p className="agent-dialog-error" data-testid="pr-dialog-error">
          {error}
        </p>
      )}
      {prs.length > 0 && (
        <ul className="pr-dialog-list" data-testid="pr-dialog-list">
          {prs.map((pr) => (
            <li className="pr-dialog-row" data-testid="pr-dialog-row" key={pr.id}>
              <span className="pr-dialog-row-title">
                #{pr.number} · {pr.title}
              </span>
              <span className="pr-dialog-row-refs">
                {pr.head_ref} → {pr.base_ref}
                {pr.is_fork ? ` · fork ${pr.head_repo}` : ""}
              </span>
              {pr.worktree_lost && (
                <span className="agent-panel-warning" data-testid="pr-dialog-row-lost">
                  its copy is gone — refresh to fetch it again
                </span>
              )}
              {notice?.id === pr.id && (
                // role="status" (an implicit aria-live="polite"): the whole point of this line is
                // that a refresh otherwise changes nothing observable, which is doubly true when
                // you can't see the row at all.
                <span
                  className="pr-dialog-row-notice"
                  role="status"
                  data-testid="pr-dialog-row-notice"
                >
                  {notice.text}
                </span>
              )}
              <span className="pr-dialog-row-actions">
                {activeWorkspace === pr.id ? (
                  <span className="pr-dialog-row-active">on canvas</span>
                ) : (
                  <button
                    type="button"
                    data-testid="pr-dialog-activate"
                    disabled={busy}
                    onClick={() => void activate(pr)}
                  >
                    Make active
                  </button>
                )}
                {getDesktopWorkspaceApi() && (
                  <button
                    type="button"
                    data-testid="pr-dialog-open-window"
                    disabled={busy}
                    onClick={() => void getDesktopWorkspaceApi()?.openWorkspaceWindow(pr.id)}
                  >
                    Open in tab
                  </button>
                )}
                <button
                  type="button"
                  data-testid="pr-dialog-refresh"
                  disabled={busy}
                  onClick={() => void refresh(pr)}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  data-testid="pr-dialog-close-pr"
                  disabled={busy}
                  onClick={() => void close(pr)}
                >
                  Close
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="agent-dialog-actions">
        <button type="button" data-testid="pr-dialog-dismiss" disabled={busy} onClick={onDismiss}>
          Done
        </button>
      </div>
    </ModalDialog>
  );
}

function primaryText(preflight: PrImportPreflight | null, busy: boolean): string {
  if (preflight === null) return "Checking…";
  if (!preflight.ready) return preflight.text ?? "Unavailable";
  return busy ? "Fetching PR…" : "Open on canvas";
}

function selectPlaceholder(
  githubPrs: GithubOpenPr[] | null,
  githubPrsError: string | null,
  availableCount: number,
): string {
  if (githubPrsError) return "Couldn't load open pull requests";
  if (githubPrs === null) return "Loading open pull requests…";
  return availableCount === 0 ? "No open pull requests" : "Select a pull request…";
}
