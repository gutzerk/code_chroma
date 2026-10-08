import type { TerminalClient, TerminalSession } from "../terminal/TerminalClient";

const ORANGE = "\x1b[38;5;209m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const HINT = "↑/↓ to move · Enter to select";
const TYPE_MS = 45;
const DEFAULT_STEP_MS = 900;
const BANNER_WIDTH = 42;

function bannerRow(visible: string, styled: string): string {
  const pad = " ".repeat(Math.max(0, BANNER_WIDTH - visible.length));
  return `${ORANGE}│${RESET}${styled}${pad}${ORANGE}│${RESET}`;
}

/** The Claude Code welcome box every scripted agent opens with. */
export function claudeBanner(cwd = "~/codechroma-tutorial"): string {
  return [
    `${ORANGE}╭${"─".repeat(BANNER_WIDTH)}╮${RESET}`,
    bannerRow(
      " ✻ Welcome to Claude Code",
      ` ${ORANGE}✻${RESET} ${BOLD}Welcome to Claude Code${RESET}`,
    ),
    bannerRow(`   cwd: ${cwd}`, `   ${DIM}cwd: ${cwd}${RESET}`),
    `${ORANGE}╰${"─".repeat(BANNER_WIDTH)}╯${RESET}`,
  ].join("\r\n");
}

/** One exchange: the user's prompt is typed, Claude optionally asks, then "works" and finishes. */
export interface Scene {
  prompt: string;
  /** Printed before the question, e.g. which skill Claude picked. */
  intro?: string;
  /** Without a question the scene goes straight to work after the prompt. */
  question?: string;
  options?: readonly string[];
  workLines: readonly string[];
  stepMs?: number;
  ack?: (choice: number) => string;
  doneLine: (choice: number) => string;
  onChosen?: (choice: number) => void;
  onDone?: (choice: number) => void;
}

type Phase = "idle" | "typing" | "choosing" | "working";

function optionLines(options: readonly string[], selected: number): string {
  const rows = options.map((label, index) =>
    index === selected
      ? `\x1b[2K${ORANGE}❯ ${index + 1}. ${label}${RESET}`
      : `\x1b[2K  ${DIM}${index + 1}. ${label}${RESET}`,
  );
  return [...rows, "\x1b[2K", `\x1b[2K  ${DIM}${HINT}${RESET}`].join("\r\n");
}

/** A scripted stand-in for `claude`, driven through a real xterm; plays one scene at a time. */
export class ScriptedSession {
  private phase: Phase = "idle";
  private selected = 0;
  private scene: Scene | null = null;
  private queue: Scene[] = [];
  private timers: number[] = [];
  private closed = false;
  private lead = 0;

  constructor(private readonly emit: (data: string) => void) {}

  private later(ms: number, action: () => void): void {
    this.timers.push(
      window.setTimeout(() => {
        if (!this.closed) action();
      }, ms),
    );
  }

  /** Prints the banner (and, for a resumed agent, a line about what it already did). */
  open(history?: string): void {
    this.lead = 300;
    this.later(300, () => {
      this.emit(claudeBanner());
      if (history) this.emit(`\r\n\r\n${GREEN}●${RESET} ${history}`);
    });
  }

  play(scene: Scene): void {
    if (this.phase !== "idle") {
      this.queue.push(scene);
      return;
    }
    this.scene = scene;
    this.phase = "typing";
    this.selected = 0;
    const lead = this.lead;
    this.lead = 0;
    this.later(lead, () => this.emit(`\r\n\r\n${BOLD}>${RESET} `));
    let delay = lead + 500;
    for (const char of scene.prompt) {
      this.later(delay, () => this.emit(char));
      delay += TYPE_MS;
    }
    this.later(delay + 300, () => this.afterPrompt(scene));
  }

  private afterPrompt(scene: Scene): void {
    const intro = scene.intro ? `\r\n\r\n${ORANGE}●${RESET} ${scene.intro}` : "";
    if (!scene.question || !scene.options) {
      this.emit(intro);
      this.work(0);
      return;
    }
    this.emit(
      `${intro}\r\n\r\n${ORANGE}●${RESET} ${scene.question}\r\n\r\n` +
        optionLines(scene.options, this.selected),
    );
    this.phase = "choosing";
  }

  handleInput(data: string): void {
    const scene = this.scene;
    if (this.phase !== "choosing" || !scene?.options) return;
    if (data === "\x1b[A" || data === "\x1b[B") {
      const count = scene.options.length;
      this.selected = (this.selected + (data === "\x1b[A" ? -1 : 1) + count) % count;
      this.emit(`\x1b[${count + 1}A\r${optionLines(scene.options, this.selected)}`);
    } else if (data === "\r") {
      this.work(this.selected);
    }
  }

  private work(choice: number): void {
    const scene = this.scene;
    if (!scene) return;
    this.phase = "working";
    const ack = scene.ack?.(choice);
    if (ack) this.emit(`\r\n\r\n${ORANGE}●${RESET} ${ack}\r\n`);
    scene.onChosen?.(choice);
    const step = scene.stepMs ?? DEFAULT_STEP_MS;
    scene.workLines.forEach((line, index) => {
      this.later(step * (index + 1), () => this.emit(`  ${DIM}⎿ ${line}${RESET}\r\n`));
    });
    const finishAt = step * (scene.workLines.length + 1);
    this.later(finishAt, () =>
      this.emit(`\r\n${GREEN}●${RESET} ${scene.doneLine(choice)}\r\n`),
    );
    this.later(finishAt + 1200, () => {
      this.phase = "idle";
      this.scene = null;
      scene.onDone?.(choice);
      const next = this.queue.shift();
      if (next) this.play(next);
    });
  }

  close(): void {
    this.closed = true;
    this.timers.forEach((timer) => window.clearTimeout(timer));
  }
}

export interface ScriptedClient extends TerminalClient {
  /** Plays a scene once the terminal is attached (queued until then). */
  play(scene: Scene): void;
}

/** A TerminalClient whose one session is a `ScriptedSession`; `setup` runs when the terminal attaches. */
export function createScriptedClient(setup: (session: ScriptedSession) => void): ScriptedClient {
  let session: ScriptedSession | null = null;
  // Scenes asked for but not finished: a terminal that reconnects (React StrictMode remounts it in
  // dev) starts a fresh session, which must pick them up again.
  const unfinished: Scene[] = [];
  return {
    play(scene) {
      const tracked: Scene = {
        ...scene,
        onDone: (choice) => {
          unfinished.splice(unfinished.indexOf(tracked), 1);
          scene.onDone?.(choice);
        },
      };
      unfinished.push(tracked);
      session?.play(tracked);
    },
    connect(): TerminalSession {
      let dataCallback: ((data: string) => void) | null = null;
      const created = new ScriptedSession((data) => dataCallback?.(data));
      session?.close();
      session = created;
      setup(created);
      unfinished.forEach((scene) => created.play(scene));
      return {
        write: (data) => created.handleInput(data),
        writeBinary: () => {},
        resize: () => {},
        onData: (callback) => {
          dataCallback = callback;
        },
        onClose: () => {},
        close: () => created.close(),
      };
    },
  };
}
