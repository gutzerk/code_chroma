// Must stay the first import: loading a profile before the registry is what a load-order cycle breaks.
import { WALKTHROUGH_PROFILE } from "./walkthroughProfile";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { diagramProfiles } from "./diagramProfiles";
import { SEQUENCE_PROFILE } from "./sequenceProfile";

const SRC = resolve(__dirname, "../..");
const RUNTIME_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^"']*?\sfrom\s+)?["'](\.[^"']+)["']/gm;

function resolveImport(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(existsSync);
}

/** The shortest runtime import chain from `start` back to itself, or null when it is not on a cycle. */
function cycleThrough(start: string): string[] | null {
  const previous = new Map<string, string>([[start, ""]]);
  const queue = [start];
  for (let file = queue.shift(); file; file = queue.shift()) {
    for (const [, spec] of readFileSync(file, "utf-8").matchAll(RUNTIME_IMPORT)) {
      const target = resolveImport(file, spec);
      if (target === start) {
        const chain = [start];
        for (let step = file; step; step = previous.get(step) ?? "") chain.unshift(step);
        return chain.map((step) => step.slice(SRC.length + 1));
      }
      if (target && !previous.has(target)) {
        previous.set(target, file);
        queue.push(target);
      }
    }
  }
  return null;
}

describe("diagram profile load order", () => {
  it("defines the walkthrough overlay when a profile loads first", () => {
    const overlay = WALKTHROUGH_PROFILE.Overlay;

    expect(overlay).toBeDefined();
  });

  it("lists both profiles when a profile loads first", () => {
    const profiles = diagramProfiles();

    expect(profiles).toEqual([SEQUENCE_PROFILE, WALKTHROUGH_PROFILE]);
  });

  it("is on no runtime import cycle, whichever profile loads first", () => {
    const registry = join(__dirname, "diagramProfiles.ts");

    const cycle = cycleThrough(registry);

    expect(cycle).toBeNull();
  });
});
