import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ATTESTATIONS_API } from "./attestation";
import { ACTIONS_ISSUER, DOWNLOAD_BASE, RELEASES_API, REPO, WORKFLOW_IDENTITY, isReleaseDownloadUrl } from "./updateConstants";
import { REPO as UPDATER_REPO, selectAsset } from "./updater";

const desktop = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(desktop, ...parts), "utf8");

describe("one source of truth for the repo identity", () => {
  it("derives every URL and the pinned workflow identity from REPO", () => {
    expect(UPDATER_REPO).toBe(REPO);
    expect(RELEASES_API).toBe(`https://api.github.com/repos/${REPO}/releases/latest`);
    expect(DOWNLOAD_BASE).toBe(`https://github.com/${REPO}/releases/latest/download`);
    expect(ATTESTATIONS_API).toBe(`https://api.github.com/repos/${REPO}/attestations/sha256`);
    expect(WORKFLOW_IDENTITY).toMatch(new RegExp(`^https://github\\.com/${REPO}/\\.github/workflows/release-please\\.yml@refs/heads/main$`));
    expect(ACTIONS_ISSUER).toBe("https://token.actions.githubusercontent.com");
  });

  it("matches the repo declared in package.json", () => {
    expect(JSON.parse(read("package.json")).homepage).toBe(`https://github.com/${REPO}`);
  });

  it("keeps the slug out of the other updater sources", () => {
    for (const file of ["updater.ts", "attestation.ts", "updateService.ts", "main.ts"]) {
      expect(read("src", file), file).not.toMatch(/gutzerk\/code_chroma/);
    }
  });
});

describe("isReleaseDownloadUrl", () => {
  it.each([
    [`https://github.com/${REPO}/releases/download/v1.0.0/a.dmg`, true],
    [`https://github.com/${REPO}/releases/latest/download/a.dmg`, true],
    [`http://github.com/${REPO}/releases/download/v1.0.0/a.dmg`, false],
    [`https://github.com/other/repo/releases/download/v1.0.0/a.dmg`, false],
    [`https://github.com.evil.test/${REPO}/releases/download/v1.0.0/a.dmg`, false],
    [`https://evil.test@github.com/${REPO}/releases/download/v1.0.0/a.dmg`, false],
    [`https://github.com/${REPO}/archive/main.zip`, false],
    ["nonsense", false],
  ])("%s -> %s", (url, ok) => expect(isReleaseDownloadUrl(url)).toBe(ok));
});

describe("artifact names agree between electron-builder.yml and the updater", () => {
  const yml = read("electron-builder.yml");
  const pattern = (section: string) => new RegExp(`^${section}:[\\s\\S]*?artifactName:\\s*(\\S+)`, "m").exec(yml)![1];
  const render = (template: string, vars: Record<string, string>) =>
    template.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] ?? `\${${key}}`);

  it.each([
    ["mac", "darwin", "arm64", { version: "9.9.9", arch: "arm64", ext: "dmg" }],
    ["mac", "darwin", "x64", { version: "9.9.9", arch: "x64", ext: "dmg" }],
    ["win", "win32", "x64", { version: "9.9.9", arch: "x64", ext: "exe" }],
    ["linux", "linux", "x64", { version: "9.9.9", arch: "x64", ext: "AppImage" }],
  ])("%s build output is selected on %s/%s", (section, platform, arch, vars) => {
    const name = render(pattern(section), vars);
    expect(selectAsset([{ name, browser_download_url: "u" }], platform, arch)?.name).toBe(name);
  });
});
