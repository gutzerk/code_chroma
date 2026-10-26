import { afterEach, describe, expect, it, vi } from "vitest";
import { saveFile } from "./saveFile";

const request = { name: "map.png", mime: "image/png", blob: new Blob([new Uint8Array([1, 2, 3])]) };

describe("saveFile", () => {
  afterEach(() => {
    delete window.codechromaDesktop;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  it("hands the base64 content to the desktop shell and reports whether it was saved", async () => {
    const desktopSave = vi.fn().mockResolvedValue({ saved: true });
    window.codechromaDesktop = { saveFile: desktopSave } as unknown as Window["codechromaDesktop"];

    const saved = await saveFile(request);

    expect(saved).toBe(true);
    expect(desktopSave).toHaveBeenCalledWith("map.png", "image/png", "AQID");
  });

  it("reports a cancelled desktop dialog", async () => {
    window.codechromaDesktop = {
      saveFile: vi.fn().mockResolvedValue({ saved: false }),
    } as unknown as Window["codechromaDesktop"];

    expect(await saveFile(request)).toBe(false);
  });

  it("writes through the browser file picker and treats an abort as a cancel", async () => {
    const write = vi.fn();
    const picker = vi.fn().mockResolvedValue({
      createWritable: async () => ({ write, close: async () => undefined }),
    });
    (window as unknown as Record<string, unknown>).showSaveFilePicker = picker;
    const saved = await saveFile(request);
    picker.mockRejectedValue(new DOMException("closed", "AbortError"));

    const cancelled = await saveFile(request);

    expect(saved).toBe(true);
    expect(write).toHaveBeenCalledWith(request.blob);
    expect(cancelled).toBe(false);
  });
});
