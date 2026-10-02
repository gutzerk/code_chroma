import { existsSync } from "node:fs";
import { join } from "node:path";

export const BRIDGE_EXECUTABLE_NAME = "codechroma-bridge";

/**
 * Packaged, the frozen bridge is an extraResource next to the app; unpackaged (npm start) it's
 * whatever `poetry run pyinstaller packaging/bridge.spec` last wrote to the repo's dist/.
 */
export function resolveBridgeExecutable(options: {
  isPackaged: boolean;
  resourcesPath: string;
  repoRoot: string;
}): string {
  const candidate = options.isPackaged
    ? join(options.resourcesPath, "bridge", BRIDGE_EXECUTABLE_NAME, BRIDGE_EXECUTABLE_NAME)
    : join(options.repoRoot, "dist", BRIDGE_EXECUTABLE_NAME, BRIDGE_EXECUTABLE_NAME);
  if (!existsSync(candidate)) {
    throw new Error(
      `frozen bridge not found at ${candidate} — run scripts/build_desktop.sh (or at least ` +
        `\`poetry run pyinstaller packaging/bridge.spec\`) first`,
    );
  }
  return candidate;
}
