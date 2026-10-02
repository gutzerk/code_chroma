import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { findFreePort, startBridge, stopBridge } from "./bridgeProcess";

describe("findFreePort", () => {
  it("returns a port that is actually bindable", async () => {
    const port = await findFreePort();
    const bound = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.on("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });

    expect(bound).toBe(true);
  });

  it("does not hand out the same port twice in a row", async () => {
    const [first, second] = await Promise.all([findFreePort(), findFreePort()]);

    expect(first).not.toBe(second);
  });
});

describe("startBridge", () => {
  it("reports the bridge's own exit instead of waiting out the ready timeout", async () => {
    const attempt = startBridge({
      executable: "/usr/bin/false",
      repoPath: process.cwd(),
      readyTimeoutMs: 30_000,
    });

    await expect(attempt).rejects.toThrow(/bridge exited/);
  });

  it("streams the child's stdout lines to onProgress", async () => {
    const lines: string[] = [];
    const attempt = startBridge({
      executable: "/bin/echo",
      repoPath: process.cwd(),
      onProgress: (line) => lines.push(line),
      readyTimeoutMs: 30_000,
    });

    await expect(attempt).rejects.toThrow(/bridge exited/);
    expect(lines.join(" ")).toContain("--repo-path");
  });
});

describe("stopBridge", () => {
  it("resolves without throwing when there is no process to stop", async () => {
    await expect(stopBridge(null)).resolves.toBeUndefined();
  });
});
