import { contextBridge, ipcRenderer } from "electron";
import type { BranchChoices } from "./branchBridge";

export interface BranchPickerState {
  project: string;
  choices: BranchChoices;
}

export type BranchPickerResult =
  | { kind: "branch"; name: string }
  | { kind: "new"; name: string; from: string }
  | { kind: "cancel" };

/** The picker page's IPC surface -- it only reads its state and reports one decision. */
export interface BranchPickerApi {
  getState(): Promise<BranchPickerState>;
  submit(result: BranchPickerResult): Promise<void>;
}

const api: BranchPickerApi = {
  getState: () => ipcRenderer.invoke("branchpicker:state"),
  submit: (result) => ipcRenderer.invoke("branchpicker:submit", result),
};

contextBridge.exposeInMainWorld("branchPicker", api);
