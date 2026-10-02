import { useEffect } from "react";
import { useAgentClient } from "./AgentClientContext";
import { useActiveWorkspace } from "./agentStore";
import { useWorkspaceStatus, workspaceStore } from "./workspaceStore";

/** How often to re-ask while a worktree's graph is coming up — fast enough to feel live, slow
 * enough that a 50k-line repo's analyze isn't polled hundreds of times. */
const POLL_MS = 500;

/**
 * 🔴 An agent workspace is brought up lazily, so the canvas can genuinely have nothing to draw for a
 * moment. Showing an empty canvas there reads as a hang — this says what is happening instead.
 *
 * Its poll is also the workspaceStore's writer, which is what makes the read-only flag correct after
 * a page reload without a second request anywhere.
 */
export function WorkspaceStatusBanner() {
  const agentClient = useAgentClient();
  const workspaceId = useActiveWorkspace();
  const status = useWorkspaceStatus();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const next = await agentClient.workspaceStatus(workspaceId);
        if (cancelled) return;
        workspaceStore.setStatus({ ...next, id: workspaceId });
        if (next.state === "analyzing") timer = setTimeout(() => void poll(), POLL_MS);
      } catch {
        // A bridge without workspace routes simply has nothing to report; stay quiet.
      }
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [agentClient, workspaceId]);

  if (!status || status.state === "ready") return null;
  return (
    <div
      className={`workspace-banner workspace-banner-${status.state}`}
      data-testid="workspace-banner"
      role="status"
    >
      {status.state === "analyzing" ? (
        <>
          <span className="workspace-banner-spinner" aria-hidden="true" />
          Building this workspace’s graph{status.progress ? ` — ${status.progress}` : "…"}
        </>
      ) : (
        `This workspace could not be analyzed: ${status.error ?? "unknown error"}`
      )}
    </div>
  );
}
