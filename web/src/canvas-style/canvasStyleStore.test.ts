import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_STYLE_DEFAULT,
  CANVAS_STYLE_PRESETS,
  canvasStyleStore,
  type CanvasStyle,
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

    canvasStyleStore.set({ ...CANVAS_STYLE_DEFAULT, texture: "dots" });

    expect(canvasStyleStore.getSaved()).toEqual({ ...CANVAS_STYLE_DEFAULT, texture: "dots" });
    expect(window.localStorage.getItem("codechroma.canvasStyle")).toContain('"dots"');

    canvasStyleStore.restoreDefault();

    expect(canvasStyleStore.getSaved()).toBeNull();
    expect(window.localStorage.getItem("codechroma.canvasStyle")).toBeNull();
  });
});

describe("canvasStyleStore bridge sync", () => {
  const remote = { bg: "#102030", texture: "dots", textureColor: "#abcdef", opacity: 30, spacing: 24 };
  const stubBridge = (get: unknown) => {
    vi.stubEnv("VITE_ENGINE_BRIDGE_URL", "http://bridge.test");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(init?.method === "PUT" || init?.method === "DELETE" ? "null" : JSON.stringify(get), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("adopts the machine-wide style another project saved", async () => {
    stubBridge(remote);

    await canvasStyleStore.hydrate();

    expect(canvasStyleStore.getSaved()).toEqual(remote);
  });

  it("publishes a style this browser already had when the bridge has none", async () => {
    const fetchMock = stubBridge(null);
    canvasStyleStore.set(remote as CanvasStyle);
    fetchMock.mockClear();

    await canvasStyleStore.hydrate();

    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual([
      "GET http://bridge.test/canvas-style",
      "PUT http://bridge.test/canvas-style",
    ]);
  });

  it("writes every change through to the bridge", () => {
    const fetchMock = stubBridge(null);

    canvasStyleStore.set(remote as CanvasStyle);
    canvasStyleStore.restoreDefault();

    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${url}`)).toEqual([
      "PUT http://bridge.test/canvas-style",
      "DELETE http://bridge.test/canvas-style",
    ]);
  });
});
