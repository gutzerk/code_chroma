/** Layers taken off the canvas while their artifact stays ready, per workspace, with the fingerprint they had then. */
const dismissed = new Map<string, string | null>();

function key(workspace: string, layer: string): string {
  return `${workspace}\u0000${layer}`;
}

/** Keeps the readiness watcher from putting `layer` straight back until its artifact changes. */
export function dismissDiagram(workspace: string, layer: string, fingerprint: string | null): void {
  dismissed.set(key(workspace, layer), fingerprint);
}

/** Forgets a dismissal: the layer is being drawn on purpose. */
export function undismissDiagram(workspace: string, layer: string): void {
  dismissed.delete(key(workspace, layer));
}

/** True while `layer` stays dismissed: no new fingerprint since it was taken off. */
export function isDiagramDismissed(workspace: string, layer: string, fingerprint: string | null): boolean {
  const k = key(workspace, layer);
  if (!dismissed.has(k)) return false;
  const at = dismissed.get(k) ?? null;
  return at === null || fingerprint === null || at === fingerprint;
}

/** Test-only: drops every dismissal. */
export function resetDismissedDiagrams(): void {
  dismissed.clear();
}
