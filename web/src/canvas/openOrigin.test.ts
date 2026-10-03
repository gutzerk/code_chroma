import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineClient } from "../engine-client/EngineClient";
import { openFilesStore } from "./openFilesStore";
import { openOrigin, parseOrigin } from "./openOrigin";

describe("parseOrigin", () => {
  it("splits a file:line origin into path and line", () => {
    expect(parseOrigin("src/a.py:12")).toEqual({ path: "src/a.py", line: 12 });
  });

  it("keeps colons inside the path (windows drive, dirs)", () => {
    expect(parseOrigin("src/team/lib.ts:3")).toEqual({ path: "src/team/lib.ts", line: 3 });
  });

  it("rejects an origin without a valid line", () => {
    expect(parseOrigin("src/a.py")).toBeNull();
    expect(parseOrigin("src/a.py:abc")).toBeNull();
    expect(parseOrigin(":12")).toBeNull();
  });
});

describe("openOrigin", () => {
  beforeEach(() => openFilesStore.reset());

  function clientWith(fragment: unknown): EngineClient {
    return { getSourceFragment: vi.fn(async () => fragment) } as unknown as EngineClient;
  }

  it("fetches a slice around the line and opens it in the code sidebar", async () => {
    const client = clientWith({ path: "src/a.py", content: "x\n", language: "python" });
    const getSourceFragment = client.getSourceFragment as ReturnType<typeof vi.fn>;

    await openOrigin("src/a.py:12", client);

    expect(getSourceFragment).toHaveBeenCalledWith("src/a.py", { start: 10, end: 14 });
    const files = openFilesStore.getFiles();
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("src/a.py:12");
    expect(files[0].source).toBe("x\n");
    expect(files[0].language).toBe("python");
  });

  it("does nothing when the engine has no getSourceFragment", async () => {
    const client = {} as EngineClient;

    await openOrigin("src/a.py:12", client);

    expect(openFilesStore.getFiles()).toHaveLength(0);
  });
});
