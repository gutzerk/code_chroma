import { describe, expect, it } from "vitest";
import { MockBridgeEngineClient } from "./mockBridge";
import { FIXTURE_NODES } from "./fixtures";

describe("MockBridgeEngineClient.getDiff", () => {
  it("returns canned changed-function entries with a real before and after", async () => {
    const client = new MockBridgeEngineClient();

    const diffs = await client.getDiff();

    const modified = diffs.filter((diff) => diff.status !== "added");
    expect(modified.length).toBeGreaterThan(0);
    for (const diff of modified) {
      const fixture = FIXTURE_NODES[diff.node_id];
      expect(fixture).toBeDefined();
      expect(diff.original_source).toBe(fixture.source ?? "");
      expect(diff.proposed_source).not.toBe(diff.original_source);
    }
  });

  it("includes an added container (new class) with a container level and empty before", async () => {
    const client = new MockBridgeEngineClient();

    const diffs = await client.getDiff();

    const added = diffs.filter((diff) => diff.status === "added");
    expect(added.length).toBeGreaterThan(0);
    for (const diff of added) {
      expect(FIXTURE_NODES[diff.node_id]).toBeDefined();
      expect(diff.level).toBe("class");
      expect(diff.original_source).toBe("");
    }
  });
});

describe("MockBridgeEngineClient.getRoute", () => {
  it("returns the direct edge as a two-node path", async () => {
    const client = new MockBridgeEngineClient();

    const path = await client.getRoute(
      "file::shadow-app/backend/routers/orders_router.py",
      "file::shadow-app/backend/domain/order_service.py",
    );

    expect(path).toEqual([
      "file::shadow-app/backend/routers/orders_router.py",
      "file::shadow-app/backend/domain/order_service.py",
    ]);
  });

  it("finds a path in the reverse direction too", async () => {
    const client = new MockBridgeEngineClient();

    const path = await client.getRoute(
      "file::shadow-app/backend/domain/order_service.py",
      "file::shadow-app/backend/routers/orders_router.py",
    );

    expect(path).toEqual([
      "file::shadow-app/backend/domain/order_service.py",
      "file::shadow-app/backend/routers/orders_router.py",
    ]);
  });

  it("resolves to null when the two nodes are unrelated", async () => {
    const client = new MockBridgeEngineClient();

    const path = await client.getRoute(
      "file::shadow-app/backend/routers/orders_router.py",
      "file::shadow-app/backend/routers/users_router.py",
    );

    expect(path).toBeNull();
  });
});

describe("MockBridgeEngineClient.subscribe", () => {
  it("fires the attached listener on a changed emit and stops after unsubscribe", () => {
    const client = new MockBridgeEngineClient();
    let calls = 0;
    const unsubscribe = client.subscribe(() => {
      calls += 1;
    });

    client.emit("changed");
    unsubscribe();
    client.emit("changed");

    expect(calls).toBe(1);
  });
});

// MockBridge mirrors apply_batch.py, including the allow-listed edge `style` (an authored edge
// color). These pin that parity so the mock can't silently drop an edge color the real bridge keeps.
describe("MockBridgeEngineClient patchCanvas edge style", () => {
  it("persists an allow-listed edge style on add_edge and clears it on update_edge", async () => {
    const client = new MockBridgeEngineClient();

    const added = await client.patchCanvas({
      ops: [
        { op: "add_element", temp_id: "n1", render: "custom", label: "A", layer: "default" },
        { op: "add_element", temp_id: "n2", render: "custom", label: "B", layer: "default" },
        { op: "add_edge", temp_id: "e1", from: "n1", to: "n2", label: "calls", style: { color: "#ff5500" } },
      ],
    });
    expect(added.ok).toBe(true);
    let doc = await client.getCanvas();
    const edge = Object.values(doc.edges).find((e) => e.label === "calls");
    expect(edge?.style).toEqual({ color: "#ff5500" });

    const updated = await client.patchCanvas({
      ops: [{ op: "update_edge", id: edge!.id, style: null }],
    });
    expect(updated.ok).toBe(true);
    doc = await client.getCanvas();
    // Mirrors apply_batch.py: sanitizeMockStyle(null) collapses to null, a valid "cleared" value.
    expect(Object.values(doc.edges).find((e) => e.id === edge!.id)?.style).toBeNull();
  });

  it("strips non-allow-listed keys from an authored edge style", async () => {
    const client = new MockBridgeEngineClient();

    const added = await client.patchCanvas({
      ops: [
        { op: "add_element", temp_id: "n1", render: "custom", label: "A", layer: "default" },
        { op: "add_element", temp_id: "n2", render: "custom", label: "B", layer: "default" },
        {
          op: "add_edge",
          temp_id: "e1",
          from: "n1",
          to: "n2",
          label: "calls",
          style: { color: "#00ff00", strokeWidth: "99", opacity: "0.5" },
        },
      ],
    });
    expect(added.ok).toBe(true);
    const doc = await client.getCanvas();
    const edge = Object.values(doc.edges).find((e) => e.label === "calls");
    expect(edge?.style).toEqual({ color: "#00ff00" });
  });
});
