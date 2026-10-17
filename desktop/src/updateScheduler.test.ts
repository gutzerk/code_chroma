import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_MIN_GAP_MS, PERIODIC_CHECK_MS } from "./updateConstants";
import { UpdateScheduler } from "./updateScheduler";

const HOUR = 3_600_000;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z")); });
afterEach(() => vi.useRealTimers());

function make() {
  const check = vi.fn(async () => {});
  const scheduler = new UpdateScheduler(check);
  return { check, scheduler };
}

describe("UpdateScheduler", () => {
  it("checks every 6 hours", async () => {
    const { check, scheduler } = make();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_MS - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_MS);
    expect(check).toHaveBeenCalledTimes(2);
    expect(PERIODIC_CHECK_MS).toBe(6 * HOUR);
  });

  it("runs an initial check on start", async () => {
    const { check, scheduler } = make();
    scheduler.start({ immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledOnce();
  });

  it("checks on focus only when the last check is old enough", async () => {
    const { check, scheduler } = make();
    scheduler.start({ immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.onFocus();
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FOCUS_MIN_GAP_MS);
    await scheduler.onFocus();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("stop cancels the timer and ignores later focus events", async () => {
    const { check, scheduler } = make();
    scheduler.start();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_MS * 2);
    await scheduler.onFocus();
    expect(check).not.toHaveBeenCalled();
  });

  it("a failing check does not stop the schedule", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const scheduler = new UpdateScheduler(check);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_MS * 2);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
