import { afterEach, describe, expect, it } from "vitest";
import {
  CANVAS_STYLE_DEFAULT,
  CANVAS_STYLE_PRESETS,
  canvasStyleStore,
  isLightBackground,
  matchPreset,
  normalizeHex,
  textureImage,
} from "./canvasStyleStore";

afterEach(() => {
  canvasStyleStore.restoreDefault();
});

describe("normalizeHex", () => {
  it.each([
    ["#0B1A2A", "#0b1a2a"],
    ["abc", "#aabbcc"],
    ["  #FFF ", "#ffffff"],
    ["#12345", null],
    ["zzzzzz", null],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeHex(raw)).toBe(expected);
  });
});

describe("isLightBackground", () => {
  it("flags light colors only", () => {
    expect(isLightBackground("#ffffff")).toBe(true);
    expect(isLightBackground("#0b1a2a")).toBe(false);
  });
});

describe("matchPreset", () => {
  it("matches a preset exactly and falls back to custom after a tweak", () => {
    const blueprint = CANVAS_STYLE_PRESETS[0];

    expect(matchPreset(blueprint)?.id).toBe("blueprint");
    expect(matchPreset({ ...blueprint, opacity: blueprint.opacity + 1 })).toBeUndefined();
  });
});

describe("textureImage", () => {
  it("paints nothing for none, a radial gradient for dots, two linear gradients for lines", () => {
    expect(textureImage("none", "#ffffff", 0.2, 1)).toBe("none");
    expect(textureImage("dots", "#ffffff", 0.2, 1)).toContain("radial-gradient");
    expect(textureImage("lines", "#ffffff", 0.2, 1).match(/linear-gradient/g)).toHaveLength(2);
  });
});

describe("canvasStyleStore", () => {
  it("starts uncustomized, persists updates and restores the default", () => {
    expect(canvasStyleStore.getSaved()).toBeNull();

    canvasStyleStore.update({ texture: "dots" });

    expect(canvasStyleStore.getSaved()).toEqual({ ...CANVAS_STYLE_DEFAULT, texture: "dots" });
    expect(window.localStorage.getItem("codechroma.canvasStyle")).toContain('"dots"');

    canvasStyleStore.restoreDefault();

    expect(canvasStyleStore.getSaved()).toBeNull();
    expect(window.localStorage.getItem("codechroma.canvasStyle")).toBeNull();
  });
});
