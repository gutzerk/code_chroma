import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { __resetGroupAvailabilityCacheForTests, useGroupAvailability } from "./useGroupAvailability";
import * as client from "./llmSettingsClient";

vi.mock("./llmSettingsClient", () => ({ listCallSites: vi.fn() }));

const listCallSites = vi.mocked(client.listCallSites);

afterEach(() => {
  vi.clearAllMocks();
  __resetGroupAvailabilityCacheForTests();
});

const GROUPS_FIXTURE = (cliAvailable: boolean) => ({
  simple: [],
  groups: [
    {
      id: "diagrams", label: "Diagrams", members: [], assignment: null,
      cli_available: cliAvailable,
    },
  ],
});

describe("useGroupAvailability", () => {
  it("starts optimistic (available) before the fetch resolves", () => {
    listCallSites.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useGroupAvailability("diagrams"));

    expect(result.current).toBe(true);
  });

  it("reports unavailable once the group's cli_available comes back false", async () => {
    listCallSites.mockResolvedValue(GROUPS_FIXTURE(false));

    const { result } = renderHook(() => useGroupAvailability("diagrams"));

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("reports available once the group's cli_available comes back true", async () => {
    listCallSites.mockResolvedValue(GROUPS_FIXTURE(true));

    const { result } = renderHook(() => useGroupAvailability("diagrams"));

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays optimistic when the bridge can't be reached at all", async () => {
    listCallSites.mockRejectedValue(new Error("no bridge: set VITE_ENGINE_BRIDGE_URL"));

    const { result } = renderHook(() => useGroupAvailability("diagrams"));

    await waitFor(() => expect(listCallSites).toHaveBeenCalled());
    expect(result.current).toBe(true);
  });

  it("shares one fetch across two components mounted at the same time", async () => {
    listCallSites.mockResolvedValue(GROUPS_FIXTURE(true));

    const first = renderHook(() => useGroupAvailability("diagrams"));
    const second = renderHook(() => useGroupAvailability("diagrams"));
    await waitFor(() => expect(first.result.current).toBe(true));
    await waitFor(() => expect(second.result.current).toBe(true));

    expect(listCallSites).toHaveBeenCalledTimes(1);
  });
});
