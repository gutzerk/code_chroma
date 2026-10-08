import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTutorialProject,
  TUTORIAL_PROJECT_NAME,
} from "./tutorialProject";

let parent: string;

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "cc-tutorial-"));
});

afterEach(() => {
  rmSync(parent, { recursive: true, force: true });
});

describe("createTutorialProject", () => {
  it("writes a frontend, backend and db layer", () => {
    const root = createTutorialProject(parent);

    expect(root).toBe(join(parent, TUTORIAL_PROJECT_NAME));
    expect(existsSync(join(root, "frontend", "ui.ts"))).toBe(true);
    expect(existsSync(join(root, "backend", "service.py"))).toBe(true);
    expect(existsSync(join(root, "db", "repository.py"))).toBe(true);
  });

  it("ships the code of both features the lesson plans", () => {
    const root = createTutorialProject(parent);

    const service = readFileSync(join(root, "backend", "service.py"), "utf8");
    const repository = readFileSync(join(root, "db", "repository.py"), "utf8");

    expect(service).toContain("def search_todos");
    expect(service).toContain("def count_open_todos");
    expect(repository).toContain("def search(");
    expect(repository).toContain("def count_open(");
  });

  it("restores an edited file when called again", () => {
    const root = createTutorialProject(parent);
    writeFileSync(join(root, "backend", "app.py"), "broken", "utf8");

    createTutorialProject(parent);

    expect(readFileSync(join(root, "backend", "app.py"), "utf8")).toContain(
      "handle_get_todos",
    );
  });
});

describe("tutorial prebuilt diagram", () => {
  it("ships a non-draft C1 diagram", () => {
    const root = createTutorialProject(parent);

    const diagram = JSON.parse(
      readFileSync(join(root, ".codechroma/diagrams/c1/c1.json"), "utf8"),
    );

    expect(diagram.type).toBe("c1");
    expect(diagram.draft).toBeUndefined();
    expect(diagram.nodes.map((node: { id: string }) => node.id)).toContain(
      "system",
    );
  });
});

describe("tutorial git history", () => {
  const porcelain = (root: string) =>
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

  it("commits an older service.py so the working tree carries a change", () => {
    const root = createTutorialProject(parent);

    expect(porcelain(root)).toBe("M backend/service.py");
  });

  it("keeps the change when called again", () => {
    createTutorialProject(parent);
    const root = createTutorialProject(parent);

    expect(porcelain(root)).toBe("M backend/service.py");
  });

  it("ships valid patterns and impact diagrams", () => {
    const root = createTutorialProject(parent);

    const read = (kind: string) =>
      JSON.parse(
        readFileSync(
          join(root, `.codechroma/diagrams/${kind}/${kind}.json`),
          "utf8",
        ),
      );

    expect(read("patterns").type).toBe("patterns");
    expect(read("impact").type).toBe("impact");
  });
});

describe("tutorial diagrams are fully connected", () => {
  function componentCount(diagram: {
    nodes: { id: string }[];
    relations: { from: string; to: string }[];
  }): number {
    const parent = new Map(diagram.nodes.map((node) => [node.id, node.id]));
    const find = (id: string): string => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root) as string;
      return root;
    };
    for (const relation of diagram.relations)
      parent.set(find(relation.from), find(relation.to));
    return new Set(diagram.nodes.map((node) => find(node.id))).size;
  }

  it.each(["c1", "patterns", "impact"])(
    "%s has one connected component",
    (kind) => {
      const root = createTutorialProject(parent);
      const diagram = JSON.parse(
        readFileSync(
          join(root, `.codechroma/diagrams/${kind}/${kind}.json`),
          "utf8",
        ),
      );

      expect(componentCount(diagram)).toBe(1);
    },
  );
});
