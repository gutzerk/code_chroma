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
  platform?: NodeJS.Platform;
}): string {
  const executableName =
    options.platform === "win32" || (!options.platform && process.platform === "win32")
      ? `${BRIDGE_EXECUTABLE_NAME}.exe`
      : BRIDGE_EXECUTABLE_NAME;
  const candidate = options.isPackaged
    ? join(options.resourcesPath, "bridge", BRIDGE_EXECUTABLE_NAME, executableName)
    : join(options.repoRoot, "dist", BRIDGE_EXECUTABLE_NAME, executableName);
  if (!existsSync(candidate)) {
    const buildInstructions = options.isPackaged
      ? "rebuild the desktop installer for this platform"
      : "`poetry run pyinstaller packaging/bridge.spec`";
    throw new Error(
      `frozen bridge not found at ${candidate} — ${buildInstructions} first`,
    );
  }
  return candidate;
}
