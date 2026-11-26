import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TerminalFontButtons } from "./TerminalFontButtons";
import { TERMINAL_FONT_MAX, terminalFontStore } from "./terminalFontStore";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("codechroma.terminalFont");
  terminalFontStore.reloadForTests();
});

describe("TerminalFontButtons", () => {
  it("steps the terminal text size up and down", () => {
    render(<TerminalFontButtons />);

    fireEvent.click(screen.getByRole("button", { name: "Larger terminal text" }));
    fireEvent.click(screen.getByRole("button", { name: "Larger terminal text" }));
    fireEvent.click(screen.getByRole("button", { name: "Smaller terminal text" }));

    expect(terminalFontStore.get()).toBe(13);
    expect(screen.getByRole("group", { name: "Terminal text size 13px" })).toBeTruthy();
  });

  it("disables A+ at the largest size", () => {
    terminalFontStore.set(TERMINAL_FONT_MAX);

    render(<TerminalFontButtons />);

    expect((screen.getByRole("button", { name: "Larger terminal text" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
