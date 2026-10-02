import { describe, expect, it } from "vitest";
import type { HierarchyLevel, HierarchyNodeRef } from "../../state/types";
import { elementCopyText, nodeCopyText } from "./nodeCopyText";

function ref(node_id: string, name: string, level: HierarchyLevel): HierarchyNodeRef {
  return { node_id, name, level, parent_id: null, has_children: false, child_count: 0 };
}

describe("nodeCopyText", () => {
  it.each([
    ["real bridge folder", ref("dir::shadow-app/backend", "backend", "folder"), "shadow-app/backend"],
    ["mock folder", ref("folder::shadow-app/backend", "backend", "folder"), "shadow-app/backend"],
    [
      "real bridge file",
      ref("component::shadow-app/backend/main.py", "main.py", "file"),
      "shadow-app/backend/main.py",
    ],
    [
      "mock file",
      ref("file::shadow-app/backend/main.py", "main.py", "file"),
      "shadow-app/backend/main.py",
    ],
    ["class", ref("class::EmailClient", "EmailClient", "class"), "EmailClient"],
    ["function", ref("function::get_db", "get_db", "function"), "get_db"],
    ["root sentinel", ref("root", "examples", "folder"), "examples"],
    ["c1 actor", ref("c1-actor::stripe", "Stripe", "code"), "Stripe"],
  ])("copies the %s as its path or name", (_label, node, expected) => {
    expect(nodeCopyText(node)).toBe(expected);
  });
});

describe("elementCopyText", () => {
  it("returns the multi-segment path decoded from a real node_id", () => {
    expect(elementCopyText("dir::application/backend/internal/auth", "Auth & Access Control")).toBe(
      "application/backend/internal/auth",
    );
  });

  it("falls back to the label for a bare top-level folder -- a coarse C1 block not yet decomposed", () => {
    expect(elementCopyText("dir::application", "Control Plane")).toBe("Control Plane");
  });

  it("falls back to the label when node_id is null", () => {
    expect(elementCopyText(null, "Control Plane")).toBe("Control Plane");
  });
});
