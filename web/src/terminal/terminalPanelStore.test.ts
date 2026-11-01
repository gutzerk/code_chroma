import { afterEach, describe, expect, it } from "vitest";
import { terminalPanelStore } from "./terminalPanelStore";

afterEach(() => {
  terminalPanelStore.reset();
});

describe("TerminalPanelStore", () => {
  it("opens a fresh terminal after closing the last one", () => {
    terminalPanelStore.open();
    terminalPanelStore.closeTerminal(1);
    expect(terminalPanelStore.getIsOpen()).toBe(false);
    terminalPanelStore.toggle();
    expect(terminalPanelStore.getIsOpen()).toBe(true);
    expect(terminalPanelStore.getTabs()).toEqual([{ id: 2, title: "Terminal 2" }]);
    expect(terminalPanelStore.getActiveTab()).toBe(2);
  });

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
