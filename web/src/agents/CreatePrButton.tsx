import { useCallback, useEffect, useState } from "react";
import type { AgentRecord, PrPreflight } from "../state/types";
import { useAgentClient } from "./AgentClientContext";
import { agentStore } from "./agentStore";
import { ModalDialog } from "./ModalDialog";

/** "Create PR" in the agent window's title bar. The button is disabled **with the preflight reason
 * as its label**, so a blocked hand-off is visible before the click rather than as a generic error
 * after it.
 *
 * 🔴 Uncommitted files are not a blocker but a question: pushing without them produces a PR that is
 * missing exactly that work, and the user finds out on GitHub. So they force an explicit choice. */
export function CreatePrButton({ agent }: { agent: AgentRecord }) {
  const agentClient = useAgentClient();
  const [preflight, setPreflight] = useState<PrPreflight | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    let cancelled = false;
    void agentClient
      .prPreflight(agent.id)
      .then((next) => {
        if (!cancelled) setPreflight(next);
      })
      .catch(() => {
        if (!cancelled) setPreflight(null);
      });
    return () => {
      cancelled = true;
    };
  }, [agentClient, agent.id]);

  // Re-run when the agent's status changes: it may have just committed, which un-blocks the button.
  useEffect(refresh, [refresh, agent.status]);

  const create = async (commitDirty: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await agentClient.createPr(agent.id, commitDirty);
      agentStore.upsert(updated);
      setAsking(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const url = agent.pr_url ?? preflight?.pr_url ?? null;
  if (url) {
    return (
      <a
        className="agent-window-pr-link"
        href={url}
        target="_blank"
        rel="noreferrer"
        data-testid={`agent-pr-link-${agent.id}`}
      >
        {prNumber(url)}
      </a>
    );
  }

  if (!preflight) return null;
  if (!preflight.ready) {
    return (
      <button
        type="button"
        className="agent-window-pr-button"
        disabled
        title={preflight.text ?? preflight.reason ?? undefined}
      >
        {preflight.text ?? "Create PR"}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="agent-window-pr-button"
        disabled={busy}
        data-testid={`agent-create-pr-${agent.id}`}
        onClick={() => (preflight.dirty.length > 0 ? setAsking(true) : void create(false))}
      >
        Create PR
      </button>
      {asking && (
        <ModalDialog
          testId="pr-dirty-dialog"
          label="Uncommitted changes"
          onDismiss={busy ? undefined : () => setAsking(false)}
        >
          <h2 className="agent-dialog-title">This agent has uncommitted changes</h2>
          <p className="agent-dialog-body">
            A push won’t pick these up, so the PR would be missing exactly this work:
          </p>
          <ul className="agent-dialog-files">
            {preflight.dirty.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
          {error && <p className="agent-dialog-error">{error}</p>}
          <div className="agent-dialog-actions">
            <button type="button" onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" onClick={() => void create(false)} disabled={busy}>
              Create PR without them
            </button>
            <button
              type="button"
              className="agent-dialog-primary"
              onClick={() => void create(true)}
              disabled={busy}
            >
              Commit them, then create
            </button>
          </div>
        </ModalDialog>
      )}
      {error && !asking && (
        <span className="agent-panel-warning" data-testid={`agent-pr-error-${agent.id}`}>
          {error}
        </span>
      )}
    </>
  );
}

/** "PR #123" from the URL, so the button reads like GitHub rather than showing a raw link. */
function prNumber(url: string): string {
  const match = /\/pull\/(\d+)/.exec(url);
  return match ? `PR #${match[1]}` : "View PR";
}
