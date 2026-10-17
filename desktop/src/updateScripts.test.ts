import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LINUX_SWAP_SCRIPT, MAC_SWAP_SCRIPT } from "./updateScripts";

const hasSh = (() => { try { execFileSync("sh", ["-c", "true"]); return true; } catch { return false; } })();
const fwd = (path: string) => path.replace(/\\/g, "/");
let dir: string;
beforeEach(() => { dir = fwd(mkdtempSync(join(tmpdir(), "codechroma-swap-"))); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Writes an executable shell stub at `path`. */
function stub(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}
/** Runs `script` under sh with a pid that is already dead, so the wait loop ends at once. */
function run(script: string, args: string[]) {
  return spawnSync("sh", ["-c", script, "sh", "999999", ...args], { encoding: "utf8", timeout: 20_000 });
}

describe.skipIf(!hasSh)("macOS swap script", () => {
  const opener = () => { const path = `${dir}/open`; stub(path, `echo "$1" >> "${dir}/opened"`); return path; };
  const bundle = (name: string, marker: string) => { mkdirSync(`${dir}/${name}`); writeFileSync(`${dir}/${name}/marker`, marker); };

  it("swaps the staged bundle in, drops the backup and opens the new app", () => {
    bundle("CodeChroma.app", "old"); bundle("staged", "new");
    const result = run(MAC_SWAP_SCRIPT, [`${dir}/staged`, `${dir}/CodeChroma.app`, opener()]);
    expect(result.status).toBe(0);
    expect(readFileSync(`${dir}/CodeChroma.app/marker`, "utf8")).toBe("new");
    expect(existsSync(`${dir}/CodeChroma.app.previous-999999`)).toBe(false);
    expect(readFileSync(`${dir}/opened`, "utf8").trim()).toBe(`${dir}/CodeChroma.app`);
  });

  it("restores the old bundle and still opens it when the staged bundle is missing", () => {
    bundle("CodeChroma.app", "old");
    const result = run(MAC_SWAP_SCRIPT, [`${dir}/staged-missing`, `${dir}/CodeChroma.app`, opener()]);
    expect(result.status).toBe(0);
    expect(readFileSync(`${dir}/CodeChroma.app/marker`, "utf8")).toBe("old");
    expect(existsSync(`${dir}/CodeChroma.app.previous-999999`)).toBe(false);
    expect(readFileSync(`${dir}/opened`, "utf8").trim()).toBe(`${dir}/CodeChroma.app`);
  });
});

describe.skipIf(!hasSh)("Linux swap script", () => {
  const good = (marker: string) => `echo ${marker} >> "${dir}/ran"; sleep 3`;
  const bad = (marker: string) => `echo ${marker} >> "${dir}/ran"; exit 1`;
  const swap = (grace = "1") => run(LINUX_SWAP_SCRIPT, [`${dir}/staged`, `${dir}/app.AppImage`, grace]);

  it("installs the new AppImage, keeps the old one as .previous and leaves a healthy launch alone", () => {
    stub(`${dir}/app.AppImage`, good("old")); stub(`${dir}/staged`, good("new"));
    const result = swap();
    expect(result.status).toBe(0);
    expect(readFileSync(`${dir}/ran`, "utf8").trim().split("\n")).toEqual(["new"]);
    expect(readFileSync(`${dir}/app.AppImage.previous`, "utf8")).toContain("echo old");
    expect(readFileSync(`${dir}/app.AppImage`, "utf8")).toContain("echo new");
  });

  it("restores the previous AppImage and launches it when the new one fails to start", () => {
    stub(`${dir}/app.AppImage`, good("old")); stub(`${dir}/staged`, bad("new"));
    const result = swap();
    expect(result.status).toBe(0);
    expect(readFileSync(`${dir}/ran`, "utf8").trim().split("\n")).toEqual(["new", "old"]);
    expect(readFileSync(`${dir}/app.AppImage`, "utf8")).toContain("echo old");
    expect(existsSync(`${dir}/app.AppImage.previous`)).toBe(false);
  });

  it("leaves the current AppImage untouched when the staged copy is missing", () => {
    stub(`${dir}/app.AppImage`, good("old"));
    swap();
    expect(readFileSync(`${dir}/app.AppImage`, "utf8")).toContain("echo old");
    expect(readFileSync(`${dir}/ran`, "utf8").trim()).toBe("old");
  });
});
