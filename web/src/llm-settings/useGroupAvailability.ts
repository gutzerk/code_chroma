import { useEffect, useState } from "react";
import { reportAsyncError } from "../util/reportError";
import { listCallSites, type CallSitesResponse } from "./llmSettingsClient";

export type CallSiteGroupId = "diagrams" | "research" | "planning";

// Several gated buttons can mount at once (ImpactChangeSummary, WikiGeneralNotice, the diagram/epic-brief
// wizards) -- one shared in-flight request instead of one per consumer. Cleared once it settles, so
// the next independent mount (e.g. after the user changes an assignment in Settings) gets a fresh read.
let sharedCallSites: Promise<CallSitesResponse> | null = null;

function fetchCallSitesShared(): Promise<CallSitesResponse> {
  if (!sharedCallSites) {
    sharedCallSites = listCallSites().finally(() => {
      sharedCallSites = null;
    });
  }
  return sharedCallSites;
}

/** Test-only escape hatch: a promise that never settles (simulating an in-flight fetch) would
 * otherwise wedge the shared cache open across test cases -- call between tests to clear it. */
export function __resetGroupAvailabilityCacheForTests(): void {
  sharedCallSites = null;
}

/** A human hint for a disabled agentic button -- points at where to fix it. */
export const NO_PROVIDER_HINT =
  "No AI provider found on PATH for this. Set one up under the gear icon → LLM settings.";

/** Whether `groupId`'s effective CLI (its assigned provider, or the default `claude`) is on PATH.
 * A group left unassigned still runs today's default CLI, so this only reports unavailable when
 * that binary is truly missing -- never a false "not configured" for an already-working setup.
 * Starts (and stays, on any fetch failure -- e.g. no bridge configured in dev mode on the mock
 * bridge) optimistic (`true`): there's nothing real to probe there, and these buttons run fixtures,
 * not an actual CLI, so a button should never flash-disable before the real check lands. */
export function useGroupAvailability(groupId: CallSiteGroupId): boolean {
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchCallSitesShared()
      .then(({ groups }) => {
        if (cancelled) return;
        const group = groups.find((g) => g.id === groupId);
        setAvailable(group ? group.cli_available : true);
      })
      .catch((err) => reportAsyncError(`useGroupAvailability(${groupId})`, err));
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return available;
}

/** Guards a disabled agentic button's click -- pair with `aria-disabled`, never native `disabled`,
 * so the button stays focusable and its `title` hint is reachable by keyboard/screen reader. */
export function guardedClick(disabled: boolean, onClick: () => void): () => void {
  return () => {
    if (!disabled) onClick();
  };
}

/** `aria-disabled`/`title` for a button gated purely on provider availability -- spread directly
 * when that's the button's only disabling condition; read just `.title` when the caller combines
 * it with another (e.g. an in-flight generation), since the hint should still name only the
 * provider as the reason, never a busy state. */
export function providerGate(providerAvailable: boolean): {
  "aria-disabled": boolean;
  title?: string;
} {
  return {
    "aria-disabled": !providerAvailable,
    title: providerAvailable ? undefined : NO_PROVIDER_HINT,
  };
}
