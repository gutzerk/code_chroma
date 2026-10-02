/** Shared HTTP plumbing for the bridge clients (EngineClient, agentClient). */

/** Pulls a human-readable reason out of a FastAPI HTTPException response body — `detail` is
 * either a plain string or an object like {"error": "..."} (see bridge/errors.py). Falls back to
 * the raw status when the body isn't JSON at all. */
export async function errorMessageFrom(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { detail?: unknown };
    const detail = body.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "error" in detail) {
      return String((detail as { error: unknown }).error);
    }
  } catch {
    // response body wasn't JSON -- fall through to the generic status-only message below
  }
  return `request failed (${response.status})`;
}

/** RequestInit for a JSON-bodied call; bare method when there is no body. */
export function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  };
}

/** One fetch call every bridge client shares: resolves VITE_ENGINE_BRIDGE_URL, throws a clear
 * "no bridge" error when unset, and surfaces the bridge's own error message on a bad response. */
export async function bridgeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const bridgeUrl = import.meta.env.VITE_ENGINE_BRIDGE_URL as string | undefined;
  if (!bridgeUrl) {
    throw new Error("no bridge: set VITE_ENGINE_BRIDGE_URL to configure the bridge");
  }
  const base = bridgeUrl === "same-origin" ? window.location.origin : bridgeUrl;
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) {
    throw new Error(await errorMessageFrom(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
