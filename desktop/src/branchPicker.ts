import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import type { BranchPickerResult, BranchPickerState } from "./branchPickerPreload";

const PICKER_PAGE = join(__dirname, "..", "branchPicker", "index.html");

let pickerOpen = false;

/** Asks which branch a second window on an already-open project should show; closing it cancels. */
export function showBranchPicker(
  parent: BrowserWindow,
  state: BranchPickerState,
): Promise<BranchPickerResult> {
  // The IPC channels are global, so a second concurrent picker would collide on registration.
  if (pickerOpen) return Promise.resolve({ kind: "cancel" });
  pickerOpen = true;
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent,
      modal: true,
      width: 460,
      height: 520,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "Open project again",
      backgroundColor: "#11131a",
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, "branchPickerPreload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    let settled = false;
    const finish = (result: BranchPickerResult) => {
      if (settled) return;
      settled = true;
      pickerOpen = false;
      ipcMain.removeHandler("branchpicker:state");
      ipcMain.removeHandler("branchpicker:submit");
      if (!picker.isDestroyed()) picker.close();
      resolve(result);
    };
    ipcMain.handle("branchpicker:state", (event) => {
      if (event.sender !== picker.webContents) throw new Error("Unknown branch picker caller");
      return state;
    });
    ipcMain.handle("branchpicker:submit", (event, result: BranchPickerResult) => {
      if (event.sender !== picker.webContents) throw new Error("Unknown branch picker caller");
      finish(result);
    });
    picker.on("closed", () => finish({ kind: "cancel" }));
    void picker.loadFile(PICKER_PAGE);
  });
}
