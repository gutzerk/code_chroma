import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { SequenceDiagram } from "./SequenceDiagram";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { HierarchyNodeRef } from "../../state/types";
import { sequenceViewStore } from "./sequenceViewStore";
import { clearStepFunctionCache } from "./sequenceStepFunctions";
import { inspectorStore } from "../inspectorStore";
import { laidOut, messageEl, participantEl } from "./sequenceTestElements";

const fn = (name: string, parent = "component::src/api.py"): HierarchyNodeRef => ({
  node_id: `${parent}::${name}`,
  name,
  level: "function",
  parent_id: parent,
  has_children: false,
  child_count: 0,
  params: "(req)",
});

let pings: Array<() => void> = [];

function fakeClient(children = [fn("handle_checkout"), fn("validate_cart"), fn("unrelated")]): EngineClient {
  return {
    subscribe: vi.fn((onChange: () => void) => {
      pings.push(onChange);
      return () => {
        pings = pings.filter((p) => p !== onChange);
      };
    }),
    getChildren: vi.fn(async () => children),
    getConnections: vi.fn(async (id: string) =>
      id.endsWith("handle_checkout") ? [{ from_id: id, to_id: "component::src/api.py::validate_cart" }] : [],
    ),
  } as unknown as EngineClient;
}

const wrap = (client: EngineClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <EngineClientProvider repoId="default" client={client}>{children}</EngineClientProvider>;
  };

const elements = () =>
  laidOut([
    participantEl("client", "ui"),
    participantEl("api", "service", { node_id: "component::src/api.py" }),
    messageEl("m1", "client", "api", "1", {}),
    messageEl("m2", "api", "client", "2"),
    messageEl("m3", "client", "api", "3"),
    messageEl("mx", "api", "client", "4", { kind: "error" }),
  ]).map((e) => (e.id === "m2" ? { ...e, label: "Checkout cart", description: "validates the cart" } : e));

function renderBoard(client = fakeClient()) {
  return render(<SequenceDiagram layer="seq" elements={elements()} />, { wrapper: wrap(client) });
}

describe("SequenceDiagram (A4 glance + expand in place)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    sequenceViewStore.reset();
    clearStepFunctionCache();
    pings = [];
  });
  afterEach(() => inspectorStore.close());

  it("draws one lane per participant plus the failure lane, and every step as a glance box", () => {
    renderBoard();

    expect(screen.getAllByTestId("sequence-lane").map((l) => l.textContent)).toEqual(["01 / CLIENT", "02 / API", "EX / Failures"]);
    expect(screen.getAllByTestId("sequence-step")).toHaveLength(4);
    expect(screen.getByText("START")).toBeInTheDocument();
    expect(screen.getByText("END")).toBeInTheDocument();
  });

  it("expands a step in place into its linked code's functions, best match first, with the call between them", async () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Expand Checkout cart" }));
    const cards = await screen.findAllByTestId("sequence-step-function");

    expect(cards.map((c) => c.textContent)).toEqual(["validate_cart()(req)", "handle_checkout()(req)", "unrelated()(req)"]);
    expect(document.querySelectorAll(".seq-exp-calls path")).toHaveLength(1);
    expect(sequenceViewStore.get("seq").expanded).toEqual(["m2"]);
  });

  it("folds an expanded step back with its caret", async () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Expand Checkout cart" }));
    await screen.findAllByTestId("sequence-step-function");

    fireEvent.click(screen.getByTestId("sequence-step-collapse"));

    expect(screen.queryByTestId("sequence-step-function")).toBeNull();
    expect(sequenceViewStore.get("seq").expanded).toEqual([]);
  });

  it("reloads an expanded step's functions after the bridge's changed ping", async () => {
    const client = fakeClient([fn("handle_checkout")]);
    renderBoard(client);
    fireEvent.click(screen.getByRole("button", { name: "Expand Checkout cart" }));
    await screen.findAllByTestId("sequence-step-function");
    vi.mocked(client.getChildren).mockResolvedValue([fn("handle_checkout"), fn("validate_cart")]);

    act(() => pings.forEach((ping) => ping()));

    await waitFor(() => expect(screen.getAllByTestId("sequence-step-function")).toHaveLength(2));
  });

  it("moves focus to the caret on expand and back to the step on collapse", async () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Expand Checkout cart" }));
    const caret = await screen.findByRole("button", { name: "Collapse Checkout cart" });
    const focusedCaret = document.activeElement === caret;
    fireEvent.click(caret);

    expect(focusedCaret).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Expand Checkout cart" }));
  });

  it("opens the step's source with Enter on its source button without expanding the step", () => {
    const open = vi.spyOn(inspectorStore, "open");
    renderBoard();
    const step = screen.getAllByTestId("sequence-step").find((s) => s.textContent?.includes("Checkout cart"))!;
    const source = within(step).getByTestId("sequence-step-src");

    fireEvent.keyDown(source, { key: "Enter" });
    fireEvent.click(source);

    expect(open).toHaveBeenCalledWith("component::src/api.py", "API", "api");
    expect(sequenceViewStore.get("seq").expanded).toEqual([]);
    open.mockRestore();
  });

  it("opens the step's source in the inspector without expanding it", () => {
    const open = vi.spyOn(inspectorStore, "open");
    renderBoard();

    const step = screen.getAllByTestId("sequence-step").find((s) => s.textContent?.includes("Checkout cart"))!;
    fireEvent.click(within(step).getByTestId("sequence-step-src"));

    expect(open).toHaveBeenCalledWith("component::src/api.py", "API", "api");
    expect(sequenceViewStore.get("seq").expanded).toEqual([]);
    open.mockRestore();
  });

  it("says so when a step has no linked code", () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Expand m3" }));

    expect(screen.getByText("No linked code for this step.")).toBeInTheDocument();
  });

  it("fades steps after the player's current step and lights the current one", () => {
    sequenceViewStore.setStep("seq", 2);
    renderBoard();

    expect(document.querySelectorAll(".seq-step--active")).toHaveLength(1);
    expect(document.querySelectorAll(".seq-step--dim")).toHaveLength(2);
  });

  it("renders the legend with every tone and arrow kind", () => {
    renderBoard();

    const legend = screen.getByTestId("sequence-legend");

    expect(legend.textContent).toContain("Entry route");
    expect(legend.textContent).toContain("Failure branch");
  });
});
