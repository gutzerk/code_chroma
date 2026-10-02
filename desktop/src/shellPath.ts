import { execFileSync } from "node:child_process";
import { delimiter } from "node:path";

const IS_WINDOWS = process.platform === "win32";

/** Fallbacks for when the login shell cannot be queried. */
const COMMON_BIN_DIRS = IS_WINDOWS
  ? [
      `${process.env.ProgramFiles ?? "C:\\Program Files"}\\nodejs`,
      `${process.env.APPDATA ?? ""}\\npm`,
      `${process.env.SystemRoot ?? "C:\\Windows"}\\System32`,
    ]
  : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

function loginShellArgs(shell: string): string[] {
  if (!IS_WINDOWS) return ["-ilc", "echo -n $PATH"];
  return shell.toLowerCase().endsWith("powershell.exe")
    ? ["-NoLogo", "-NoProfile", "-Command", "$env:Path"]
    : ["/d", "/s", "/c", "echo %PATH%"]; 
}

/**
 * A Finder-launched app inherits launchd's minimal PATH, so `claude`, `git` and `npm` are invisible
 * to the bridge we spawn (skill_agent.py fails with "claude CLI not found on PATH"). Asking the
 * user's login shell for its own PATH is the only way to recover what a terminal launch would see.
 */
export function loginShellPath(shell: string | undefined, currentPath: string | undefined): string {
  const parts: string[] = [];
  if (shell) {
    try {
      const output = execFileSync(shell, loginShellArgs(shell), {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      parts.push(...output.trim().split(delimiter));
    } catch {
      // Shell missing, non-interactive, or slow to start -- the fallbacks below still help.
    }
  }
  parts.push(...(currentPath ?? "").split(delimiter), ...COMMON_BIN_DIRS);
  return dedupe(parts.filter(Boolean)).join(delimiter);
}

/** Mutates process.env.PATH once at startup so every child process we spawn inherits the fix. */
export function repairProcessPath(env: NodeJS.ProcessEnv = process.env): string {
  const shell = IS_WINDOWS ? env.ComSpec ?? env.COMSPEC : env.SHELL;
  env.PATH = loginShellPath(shell, env.PATH);
  return env.PATH;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
