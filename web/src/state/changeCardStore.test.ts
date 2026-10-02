import { afterEach, describe, expect, it } from "vitest";
import { changeCardStore } from "./changeCardStore";
import { expansionStore } from "./expansionState";
import type { ChangeCard } from "./types";

function card(overrides: Partial<ChangeCard> = {}): ChangeCard {
  return {
    id: "a.py::function::foo",
    text: "Modified foo",
    details: "",
    node_id: "function::foo",
    kind: "modify",
    resolution: "exact",
    file: "a.py",
    symbol: "foo",
    name: "foo",
    target: "function",
    status: "modified",
    added_lines: 2,
    removed_lines: 1,
    binary: false,
    ...overrides,
  };
}

const CARD_A = card();
const CARD_B = card({ id: "b", node_id: "class::Users", name: "create", symbol: "Users.create" });
const CARD_C = card({ id: "c", node_id: "class::Users", name: "delete", symbol: "Users.delete" });

afterEach(() => {
  changeCardStore.reset();
  expansionStore.reset();
});

describe("changeCardStore", () => {
  it("has no cards for a node and is inactive by default", () => {
    expect(changeCardStore.getSteps("function::foo")).toEqual([]);
    expect(changeCardStore.getIsActive()).toBe(false);
  });

  it("groups several cards onto one node and marks itself active", () => {
    changeCardStore.setSteps([CARD_A, CARD_B, CARD_C]);

    expect(changeCardStore.getSteps("function::foo")).toEqual([CARD_A]);
    expect(changeCardStore.getSteps("class::Users")).toEqual([CARD_B, CARD_C]);
    expect(changeCardStore.getIsActive()).toBe(true);
  });

  it("returns the same stable empty array for an untargeted node", () => {
    changeCardStore.setSteps([CARD_A]);

    expect(changeCardStore.getSteps("class::Users")).toBe(changeCardStore.getSteps("dir::nope"));
  });

  it("exposes every card in insertion order", () => {
    changeCardStore.setSteps([CARD_A, CARD_B, CARD_C]);

    expect(changeCardStore.getAllSteps()).toEqual([CARD_A, CARD_B, CARD_C]);
  });

  it("stays active when a change set legitimately resolves to zero cards", () => {
    changeCardStore.setSteps([]);

    expect(changeCardStore.getIsActive()).toBe(true);
    expect(changeCardStore.getAllSteps()).toEqual([]);
  });

  it("notifies geometry listeners without notifying card listeners", () => {
    let cardNotifications = 0;
    let geometryNotifications = 0;
    changeCardStore.subscribe(() => cardNotifications++);
    changeCardStore.geometry.subscribe(() => geometryNotifications++);

    changeCardStore.notifyGeometryChange();

    expect(geometryNotifications).toBe(1);
    expect(cardNotifications).toBe(0);
  });

  it("clears without touching expansion state", () => {
    expansionStore.expand("file::a.py");
    changeCardStore.setSteps([CARD_A]);

    changeCardStore.clear();

    expect(changeCardStore.getIsActive()).toBe(false);
    expect(expansionStore.getBlockView("file::a.py").expand_state).toBe("expanded");
  });

  it("gives every unknown node its own stable empty array", () => {
    expect(changeCardStore.getSteps("function::foo")).toEqual([]);
    expect(changeCardStore.getSteps("function::foo")).toBe(changeCardStore.getSteps("function::foo"));
  });
});
