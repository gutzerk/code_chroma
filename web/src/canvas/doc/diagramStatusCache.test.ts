import { afterEach, describe, expect, it, vi } from "vitest";
import { readCachedDiagramsStatus, writeCachedDiagramsStatus } from "./diagramStatusCache";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("diagramStatusCache", () => {
  it("round-trips a status map through sessionStorage", () => {
    const status = { c1: { ready: true, fingerprint: "abc" } };

    writeCachedDiagramsStatus(status);

    expect(readCachedDiagramsStatus()).toEqual(status);
  });

  it("returns null when nothing has been cached yet", () => {
    expect(readCachedDiagramsStatus()).toBeNull();
  });

  it("returns null instead of throwing on corrupt JSON", () => {
    sessionStorage.setItem("codechroma.diagramsStatusCache", "{not json");

    expect(readCachedDiagramsStatus()).toBeNull();
  });

  it("swallows a write failure instead of throwing (quota/privacy mode)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => writeCachedDiagramsStatus({ c1: { ready: true } })).not.toThrow();
  });
});
