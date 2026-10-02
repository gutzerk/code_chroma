import { useEffect, useRef } from "react";
import { AgentClientProvider } from "./agents/AgentClientContext";
import { useActiveWorkspace } from "./agents/agentStore";
import { EngineClientProvider } from "./engine-client/EngineClientContext";
import { TerminalClientProvider } from "./terminal/TerminalClientContext";
import { RootCanvas } from "./canvas/RootCanvas";
import { resetWorkspaceStores } from "./state/createStore";

export function App() {
  // The active workspace *is* the repo id: switching agents rebuilds the engine client, so every
  // request the canvas makes — children, connections, diff, plan, c1, impact-changes, traces — moves to
  // that worktree at once. Missing one would silently show the main repo's data on the agent's canvas.
  const workspaceId = useActiveWorkspace();

  // The stores are module globals, so they survive the client swap (and any remount) — reset every
  // workspace-scoped one explicitly, or the previous worktree's expansion/diff/plan/selection state
  // leaks onto the new canvas. Skipped on first render: initial mount isn't a switch.
  const previousWorkspaceRef = useRef(workspaceId);
  useEffect(() => {
    if (previousWorkspaceRef.current === workspaceId) return;
    previousWorkspaceRef.current = workspaceId;
    resetWorkspaceStores();
  }, [workspaceId]);

  return (
    <AgentClientProvider>
      <EngineClientProvider repoId={workspaceId}>
        <TerminalClientProvider>
          <RootCanvas />
        </TerminalClientProvider>
      </EngineClientProvider>
    </AgentClientProvider>
  );
}
