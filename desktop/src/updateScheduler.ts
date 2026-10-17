import { FOCUS_MIN_GAP_MS, PERIODIC_CHECK_MS } from "./updateConstants";

/** Runs `check` every 6 hours and on window focus (throttled); a failing check never stops the schedule. */
export class UpdateScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastRun = 0;
  private running = false;

  constructor(private check: () => Promise<unknown>) {}

  start(opts: { immediate?: boolean } = {}): void {
    this.stop();
    this.timer = setInterval(() => void this.run(), PERIODIC_CHECK_MS);
    this.timer.unref?.();
    if (opts.immediate) void this.run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async onFocus(): Promise<void> {
    if (!this.timer || Date.now() - this.lastRun < FOCUS_MIN_GAP_MS) return;
    await this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastRun = Date.now();
    try { await this.check(); } catch { /* the service already surfaces errors */ } finally { this.running = false; }
  }
}
