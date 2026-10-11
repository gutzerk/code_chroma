import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addRecent, MAX_RECENTS, readRecents, recentsStorePath, removeRecent } from "./recentRepos";

let dir: string;
let store: string;

/** Creates a real repo dir under the temp root, since readRecents drops missing paths. */
function repoDir(name: string): string {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codechroma-recents-"));
  store = recentsStorePath(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readRecents", () => {
  it("returns an empty list when the store has never been written", () => {
    expect(readRecents(store)).toEqual([]);
  });

  it("returns an empty list rather than throwing on a corrupt store", () => {
    writeFileSync(store, "{not json");

    expect(readRecents(store)).toEqual([]);
  });

  it("flags entries whose directory no longer exists instead of dropping them", () => {
    const alive = repoDir("alive");
    const gone = join(dir, "since-deleted");
    addRecent(store, alive, 1000);
    addRecent(store, gone, 2000);

    expect(readRecents(store).map((entry) => [entry.path, entry.missing])).toEqual([
      [gone, true],
      [alive, false],
    ]);
  });
});

describe("addRecent", () => {
  it("puts the newly opened repo first", () => {
    const first = repoDir("first");
    const second = repoDir("second");
    addRecent(store, first, 1000);
    addRecent(store, second, 2000);

    expect(readRecents(store).map((entry) => entry.path)).toEqual([second, first]);
  });

  it("dedupes by path instead of growing a duplicate entry", () => {
    const repo = repoDir("repo");
    addRecent(store, repo, 1000);
    const result = addRecent(store, repo, 2000);

    expect(result).toHaveLength(1);
    expect(result[0]?.openedAt).toBe(2000);
  });

  it("caps the list at MAX_RECENTS", () => {
    for (let index = 0; index < MAX_RECENTS + 5; index += 1) {
      addRecent(store, repoDir(`repo-${index}`), index);
    }

    expect(readRecents(store)).toHaveLength(MAX_RECENTS);
  });

  it("names an entry by its last two path segments so siblings stay distinguishable", () => {
    const result = addRecent(store, "/Users/me/projects/atlas", 1000);

    expect(result[0]?.name).toBe("projects/atlas");
  });
});

describe("removeRecent", () => {
  it("forgets only the given entry and leaves the folder on disk", () => {
    const keep = repoDir("keep");
    const drop = repoDir("drop");
    addRecent(store, keep, 1000);
    addRecent(store, drop, 2000);

    const next = removeRecent(store, drop);

    expect(next.map((entry) => entry.path)).toEqual([keep]);
    expect(existsSync(drop)).toBe(true);
  });
});
