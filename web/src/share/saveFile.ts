import { getDesktopWorkspaceApi } from "../agents/desktopWorkspaceApi";

export interface SaveRequest {
  name: string;
  mime: string;
  /** May still be rendering: the picker opens first so the click's user activation is still live. */
  blob: Blob | Promise<Blob>;
}

/** True when the user picked a place, false when they cancelled the dialog. */
export async function saveFile({ name, mime, blob }: SaveRequest): Promise<boolean> {
  const desktop = getDesktopWorkspaceApi();
  if (desktop?.saveFile) {
    const result = await desktop.saveFile(name, mime, await toBase64(await blob));
    return result.saved;
  }
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    if (blob instanceof Promise) blob.catch(() => undefined);
    try {
      const extension = name.slice(name.lastIndexOf("."));
      const handle = await picker({
        suggestedName: name,
        types: [{ description: extension.slice(1).toUpperCase(), accept: { [mime]: [extension] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(await blob);
      await writable.close();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      throw error;
    }
  }
  downloadBlob(name, await blob);
  return true;
}

type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
