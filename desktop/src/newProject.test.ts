import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, validateProjectName } from "./newProject";

let parent: string;

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "cc-newproject-"));
});

afterEach(() => {
  rmSync(parent, { recursive: true, force: true });
});

describe("validateProjectName", () => {
  it.each(["", "   ", ".", "..", "a/b", "a\\b", "bad:name", "trailing."])(
    "rejects %j",
    (name) => {
      expect(validateProjectName(name)).not.toBeNull();
    },
  );

  it("accepts a plain name", () => {
    expect(validateProjectName("my-app")).toBeNull();
  });
});

describe("createProject", () => {
  it("writes the scaffold and initialises git", () => {
    const root = createProject(parent, "demo");

    expect(root).toBe(join(parent, "demo"));
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("# demo");
    expect(existsSync(join(root, "src", "main.py"))).toBe(true);
    expect(existsSync(join(root, ".git"))).toBe(true);
  });

  it("refuses a non-empty existing folder", () => {
    mkdirSync(join(parent, "demo"));
    writeFileSync(join(parent, "demo", "x.txt"), "x");

    expect(() => createProject(parent, "demo")).toThrow(/not empty/);
  });

  it("refuses a missing parent directory", () => {
    expect(() => createProject(join(parent, "nope"), "demo")).toThrow(/does not exist/);
  });
});
