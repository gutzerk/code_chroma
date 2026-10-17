import { REPO_URL } from "./updateConstants";

const bare = (version: string) => version.trim().replace(/^v/i, "");

/** Window title carrying the app version, e.g. `repo [Main] - CodeChroma 0.12.1`. */
export function windowTitle(version: string, tab?: string): string {
  const v = bare(version);
  const product = v ? `CodeChroma ${v}` : "CodeChroma";
  return tab ? `${tab} - ${product}` : product;
}

/** Content for the About dialog (all platforms; macOS also gets the native app-menu About). */
export function aboutMessage(version: string): { title: string; message: string; detail: string } {
  return { title: "About CodeChroma", message: "CodeChroma", detail: `Version ${bare(version)}\n${REPO_URL}` };
}
