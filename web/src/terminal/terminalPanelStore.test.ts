import { afterEach, describe, expect, it } from "vitest";
import { terminalPanelStore } from "./terminalPanelStore";

afterEach(() => {
  terminalPanelStore.reset();
});

describe("TerminalPanelStore", () => {
  it("defaults to closed with the shell agent selected", () => {
    expect(terminalPanelStore.getIsOpen()).toBe(false);
    expect(terminalPanelStore.getSelectedAgent()).toBe("shell");
  });

  it("toggles open and closed", () => {
    terminalPanelStore.toggle();
    expect(terminalPanelStore.getIsOpen()).toBe(true);

    terminalPanelStore.toggle();
    expect(terminalPanelStore.getIsOpen()).toBe(false);
  });

  it("switches the selected agent", () => {
    terminalPanelStore.selectAgent("codex");
    expect(terminalPanelStore.getSelectedAgent()).toBe("codex");
  });
});
