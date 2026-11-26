import { describe, expect, it } from "vitest";
import { MAX_SEEK_STEPS, PAGE_DOWN, PAGE_UP, seekPromptOnAltScreen, type AltScreenDriver } from "./altScreenSeek";

const PROMPTS = [{ text: "first question" }, { text: "second question" }, { text: "third question" }];

/** A transcript like fullscreen claude draws it: each prompt's echo, a blank row, then `reply` rows of answer. */
function transcript(reply = 30): string[] {
  return ["  Claude Code banner", "", ...PROMPTS.flatMap((p, i) => [
    `❯ ${p.text}`,
    "",
    ...Array.from({ length: reply }, (_, r) => `${r === 0 ? "●" : " "} answer ${i + 1}.${r + 1}`),
  ])];
}

/** A fullscreen TUI in miniature: a window of `rows` over its transcript, page keys move half a screen, the top row pins the prompt being read. */
function fakeTui(lines: string[], rows = 10, startAtBottom = true, dropKeys = 0) {
  const page = Math.floor(rows / 2);
  let top = startAtBottom ? Math.max(0, lines.length - rows) : 0;
  let dropped = 0;
  const sent: string[] = [];
  const view = () => {
    const shown = lines.slice(top, top + rows);
    const echo = lines.slice(0, top + 1).reverse().find((line) => line.startsWith("❯"));
    if (echo && !shown[0].startsWith("❯") && top > 0) shown[0] = echo;
    return shown;
  };
  const driver: AltScreenDriver = {
    rows: view,
    send: (data) => {
      sent.push(data);
      if (dropped < dropKeys) {
        dropped++;
        return;
      }
      if (data === PAGE_UP) top = Math.max(0, top - page);
      if (data === PAGE_DOWN) top = Math.min(Math.max(0, lines.length - rows), top + page);
    },
    settled: () => Promise.resolve(),
  };
  return { driver, sent, view };
}

describe("seekPromptOnAltScreen", () => {
  it("pages up until the prompt's echo shows below the pinned header row", async () => {
    const tui = fakeTui(transcript());

    const row = await seekPromptOnAltScreen(tui.driver, PROMPTS, 1);

    expect(row).not.toBeNull();
    expect(row).toBeGreaterThan(0);
    expect(tui.view()[row!]).toBe("❯ first question");
    expect(new Set(tui.sent)).toEqual(new Set([PAGE_UP]));
  });

  it("does not type anything when the echo is already on screen", async () => {
    const tui = fakeTui(transcript(3), 20);

    const row = await seekPromptOnAltScreen(tui.driver, PROMPTS, 3);

    expect(tui.view()[row!]).toBe("❯ third question");
    expect(tui.sent).toEqual([]);
  });

  it("pages down to a later prompt when the screen shows an earlier one", async () => {
    const tui = fakeTui(transcript(), 10, false);

    const row = await seekPromptOnAltScreen(tui.driver, PROMPTS, 3);

    expect(tui.view()[row!]).toBe("❯ third question");
    expect(new Set(tui.sent)).toEqual(new Set([PAGE_DOWN]));
  });

  it("does not take one dropped key for the end of the transcript", async () => {
    const tui = fakeTui(transcript(), 10, true, 1);

    const row = await seekPromptOnAltScreen(tui.driver, PROMPTS, 1);

    expect(tui.view()[row!]).toBe("❯ first question");
  });

  it("tries the other way once an end stops moving, then gives up on a prompt that is not there", async () => {
    const tui = fakeTui(transcript(5), 6);

    const row = await seekPromptOnAltScreen(tui.driver, [...PROMPTS, { text: "never asked" }], 4);

    expect(row).toBeNull();
    expect(tui.sent).toContain(PAGE_UP);
    expect(tui.sent).toContain(PAGE_DOWN);
    expect(tui.sent.length).toBeLessThan(MAX_SEEK_STEPS);
  });

  it("stops as soon as a newer jump cancels it", async () => {
    const tui = fakeTui(transcript());
    let calls = 0;

    const row = await seekPromptOnAltScreen(tui.driver, PROMPTS, 1, () => ++calls > 2);

    expect(row).toBeNull();
    expect(tui.sent).toHaveLength(2);
  });

  it("settles for the top row when the echo is the transcript's very first line", async () => {
    const tui = fakeTui(transcript().slice(2));

    const row = await seekPromptOnAltScreen(tui.driver, PROMPTS, 1);

    expect(row).toBe(0);
    expect(tui.view()[0]).toBe("❯ first question");
  });

  it("is bounded by the step limit", async () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `  line ${i}`);
    lines[0] = "❯ first question";
    const tui = fakeTui(lines, 10);

    const row = await seekPromptOnAltScreen(tui.driver, PROMPTS, 1, () => false, 20);

    expect(row).toBeNull();
    expect(tui.sent).toHaveLength(20);
  });
});
