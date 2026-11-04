import { describe, expect, it } from "vitest";
import { pathOfNodeId, rollupImpactChange } from "./impactRollup";
import { EMPTY_IMPACT_CHANGES, type ImpactBlockChange, type ImpactChanges } from "../state/types";

function block(overrides: Partial<ImpactBlockChange>): ImpactBlockChange {
  return {
    block: "x",
    node_id: "x",
    name: "x",
    path: null,
    status: "modified",
    files: [],
    change_count: 0,
    before: "",
    after: "",
    explanation: "",
    pr_comments: [],
    ...overrides,
  };
}

const BUILDER = block({
  block: "component::src/graph/builder.py",
  node_id: "component::src/graph/builder.py",
  name: "builder.py",
  path: "src/graph/builder.py",
  files: [{ path: "src/graph/builder.py", status: "modified" }],
  after: "Builds one node per directory.",
});

const ADDED_FN = block({
  block: "src/api/routes.py::function::health",
  node_id: "src/api/routes.py::function::health",
  name: "health",
  path: "src/api/routes.py",
  status: "added",
  files: [{ path: "src/api/routes.py", status: "added" }],
});

const OUTSIDE = block({
  block: "component::web/app.ts",
  node_id: "component::web/app.ts",
  name: "app.ts",
  path: "web/app.ts",
  files: [{ path: "web/app.ts", status: "modified" }],
});

function changes(blocks: ImpactBlockChange[], overrides: Partial<ImpactChanges> = {}): ImpactChanges {
  return { ...EMPTY_IMPACT_CHANGES, blocks, changed_file_count: 3, ...overrides };
}

describe("pathOfNodeId", () => {
  it.each([
    ["dir::src", "src"],
    ["component::src/a.py", "src/a.py"],
    ["src/a.py::function::run", "src/a.py"],
    ["service::src/a.py::functions", "src/a.py"],
    ["collapsed::auth", null],
  ])("maps %s to %s", (nodeId, expected) => {
    expect(pathOfNodeId(nodeId)).toBe(expected);
  });
});

describe("rollupImpactChange", () => {
  it("rolls every changed file under a folder box into it when the box has no files of its own", () => {
    const snapshot = changes([BUILDER, ADDED_FN, OUTSIDE]);

    const rollup = rollupImpactChange(snapshot, "dir::src");

    expect(rollup?.change.files.map((file) => file.path)).toEqual(["src/graph/builder.py", "src/api/routes.py"]);
    expect(rollup?.change.status).toBe("modified");
    expect(rollup?.nested.map((inner) => inner.name)).toEqual(["builder.py", "health"]);
  });

  it("finds a collapsed box's own review by its recipe key, not its node id", () => {
    const own = block({ block: "collapsed::src", node_id: "collapsed::src", name: "src", after: "Whole tree moved." });
    const snapshot = changes([own, BUILDER]);

    const rollup = rollupImpactChange(snapshot, "dir::src", "collapsed::src");

    expect(rollup?.change.after).toBe("Whole tree moved.");
    expect(rollup?.change.files.map((file) => file.path)).toEqual(["src/graph/builder.py"]);
  });

  it("includes unassigned changed files under the folder", () => {
    const snapshot = changes([], { unassigned: [{ path: "src/README.md", status: "added" }] });

    const rollup = rollupImpactChange(snapshot, "dir::src");

    expect(rollup?.change.files).toEqual([{ path: "src/README.md", status: "added" }]);
    expect(rollup?.change.status).toBe("added");
  });

  it("returns the box's own record unchanged when nothing else lies under it", () => {
    const snapshot = changes([BUILDER, OUTSIDE]);

    const rollup = rollupImpactChange(snapshot, BUILDER.node_id);

    expect(rollup?.change).toBe(BUILDER);
  });

  it("returns nothing for a folder with no changes under it", () => {
    const snapshot = changes([OUTSIDE]);

    const rollup = rollupImpactChange(snapshot, "dir::src");

    expect(rollup).toBeUndefined();
  });
});
