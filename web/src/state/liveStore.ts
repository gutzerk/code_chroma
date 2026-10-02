import { VersionStore, useVersion } from "./versionStore";

/**
 * Bumped once per live "changed" ping from the bridge (see EngineClient.subscribe). Data-fetching
 * hooks (useNodeChildren) and RootCanvas read it via useLiveVersion and re-fetch when it moves —
 * one shared signal instead of every component holding its own WebSocket.
 */
export const liveStore = new VersionStore();

export function useLiveVersion(): number {
  return useVersion(liveStore);
}
