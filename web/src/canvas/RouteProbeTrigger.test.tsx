import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouteProbeTrigger } from "./RouteProbeTrigger";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import type { EngineClient } from "../engine-client/EngineClient";
import { selectionStore } from "../state/selectionStore";
import { routeProbeStore } from "../state/routeProbeStore";

function stubClient(getRoute: EngineClient["getRoute"]): EngineClient {
  return { getRoute } as unknown as EngineClient;
}

function renderTrigger(client: EngineClient) {
  return render(
    <EngineClientProvider repoId="test" client={client}>
      <RouteProbeTrigger />
    </EngineClientProvider>,
  );
}

afterEach(() => {
  selectionStore.reset();
  routeProbeStore.reset();
});

describe("RouteProbeTrigger", () => {
  it("renders nothing unless exactly two nodes are selected", () => {
    const client = stubClient(async () => null);
    renderTrigger(client);
    expect(screen.queryByTestId("route-probe-trigger")).toBeNull();

    act(() => selectionStore.replace(["a"]));
    expect(screen.queryByTestId("route-probe-trigger")).toBeNull();

    act(() => selectionStore.addMany(["b", "c"]));
    expect(screen.queryByTestId("route-probe-trigger")).toBeNull();
  });

  it("probes the route for the two selected nodes on click", async () => {
    const getRoute = vi.fn(async () => ["a", "b"]);
    renderTrigger(stubClient(getRoute));
    act(() => selectionStore.replace(["a", "b"]));

    fireEvent.click(screen.getByTestId("route-probe-trigger"));

    await waitFor(() => expect(getRoute).toHaveBeenCalledWith("a", "b"));
    await waitFor(() => expect(routeProbeStore.getSnapshot().path).toEqual(["a", "b"]));
  });

  it("clears an already-shown route on a second click", async () => {
    const getRoute = vi.fn(async () => ["a", "b"]);
    renderTrigger(stubClient(getRoute));
    act(() => selectionStore.replace(["a", "b"]));
    fireEvent.click(screen.getByTestId("route-probe-trigger"));
    await waitFor(() => expect(routeProbeStore.getSnapshot().path).toEqual(["a", "b"]));

    fireEvent.click(screen.getByTestId("route-probe-trigger"));

    expect(routeProbeStore.getSnapshot().path).toBeNull();
  });
});
