/** Central sink for async failures the canvas used to swallow.
 *
 * A fetch-on-mount hook without a .catch turns a transient bridge error into an unhandled
 * rejection plus a permanently blank or "loading" surface. Every read-path .catch funnels here so
 * failures are at least visible in the console with a scope, and the global reporter catches
 * whatever still slips through.
 */

export function reportAsyncError(scope: string, error: unknown): void {
  console.error(`[codechroma] ${scope} failed:`, error);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let installed = false;

/** Installs a window-level unhandledrejection reporter once (main.tsx calls this at boot). */
export function installRejectionReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[codechroma] unhandled rejection:", event.reason);
  });
}
