import { afterEach, describe, expect, it } from "vitest";
import { agentStore } from "../agents/agentStore";
import {
  clearSavedCameraView,
  readSavedCameraView,
  writeSavedCameraView,
} from "./canvasCameraStore";

const KEY = "codechroma.cameraView";

afterEach(() => {
  agentStore.reset();
  window.localStorage.clear();
});

describe("canvasCameraStore", () => {
  it("returns null when nothing is saved for the active workspace", () => {
    expect(readSavedCameraView()).toBeNull();
  });

  it("round-trips a persisted view", () => {
    writeSavedCameraView({ x: 120, y: -40, scale: 1.5 });

    expect(readSavedCameraView()).toEqual({ x: 120, y: -40, scale: 1.5 });
  });

  it("treats the reset origin as nothing saved", () => {
    writeSavedCameraView({ x: 0, y: 0, scale: 1 });

    expect(readSavedCameraView()).toBeNull();
  });

  it("keys the view per active workspace so one worktree never inherits another's", () => {
    writeSavedCameraView({ x: 120, y: -40, scale: 1.5 });

    agentStore.setActiveWorkspace("a");

    expect(readSavedCameraView()).toBeNull();

    agentStore.reset();

    expect(readSavedCameraView()).toEqual({ x: 120, y: -40, scale: 1.5 });
  });

  it("clear removes the persisted view", () => {
    writeSavedCameraView({ x: 120, y: -40, scale: 1.5 });
    clearSavedCameraView();

    expect(readSavedCameraView()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("returns null for corrupted stored data instead of throwing", () => {
    window.localStorage.setItem(KEY, "not-json");

    expect(readSavedCameraView()).toBeNull();

    window.localStorage.setItem(KEY, JSON.stringify({ x: "oops", y: 1, scale: 1 }));

    expect(readSavedCameraView()).toBeNull();
  });
});
