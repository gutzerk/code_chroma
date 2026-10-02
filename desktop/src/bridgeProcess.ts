import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface BridgeHandle {
  port: number;
  origin: string;
  process: ChildProcess;
}

export interface StartBridgeOptions {
  executable: string;
  repoPath: string;
  /** Called with each stdout/stderr line so the launcher window can show real progress. */
  onProgress?: (line: string) => void;
  readyTimeoutMs?: number;
}

/** Asks the OS for an unused port, so a second window (or a stray :8000) can't collide with us. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("could not determine a free port")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/** Spawns the frozen bridge on a free port and resolves once /health answers. */
export async function startBridge(options: StartBridgeOptions): Promise<BridgeHandle> {
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    options.executable,
    ["--repo-path", options.repoPath, "--port", String(port)],
    { cwd: options.repoPath, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );

  const report = options.onProgress ?? (() => {});
  forwardLines(child, report);

  let exitReason: string | null = null;
  child.on("exit", (code, signal) => {
    exitReason = `bridge exited (code ${code ?? "null"}, signal ${signal ?? "none"})`;
  });

  const deadline = Date.now() + (options.readyTimeoutMs ?? 600_000);
  while (Date.now() < deadline) {
    if (exitReason !== null) {
      throw new Error(exitReason);
    }
    if (await isHealthy(origin)) {
      return { port, origin, process: child };
    }
    // Analyze on a large repo takes minutes, so poll with a real delay rather than spinning.
    await delay(400);
  }
  await stopBridge(child);
  throw new Error(`bridge did not become ready within ${options.readyTimeoutMs ?? 600_000}ms`);
}

/** SIGTERM then SIGKILL, mirroring launch.py's _terminate so no bridge outlives the window. */
export async function stopBridge(child: ChildProcess | null, graceMs = 5000): Promise<void> {
  if (child === null || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = delay(graceMs).then(() => "timeout" as const);
  if ((await Promise.race([exited.then(() => "exited" as const), timer])) === "timeout") {
    child.kill("SIGKILL");
  }
}

async function isHealthy(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function forwardLines(child: ChildProcess, report: (line: string) => void): void {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) {
          report(line.trim());
        }
      }
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
