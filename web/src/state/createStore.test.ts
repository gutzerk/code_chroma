import { describe, expect, it } from "vitest";
import { Store, resetWorkspaceStores } from "./createStore";

class CounterStore extends Store {
  count = 0;

  increment = (): void => {
    this.count += 1;
    this.emit();
  };

  reset = (): void => {
    this.count = 0;
    this.emit();
  };
}

describe("Store", () => {
  it("notifies subscribers on emit and stops after unsubscribe", () => {
    const store = new CounterStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.increment();
    unsubscribe();
    store.increment();

    expect(calls).toBe(1);
  });
});

describe("resetWorkspaceStores", () => {
  it("resets every Store by default and leaves global ones alone", () => {
    const scoped = new CounterStore();
    const global = new CounterStore().markGlobalStore();
    scoped.increment();
    global.increment();

    resetWorkspaceStores();

    expect(scoped.count).toBe(0);
    expect(global.count).toBe(1);
  });
});
