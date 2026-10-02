import type { HierarchyLevel } from "../../state/types";

/** The noun on the Show/Hide-code button — "File" for a whole file, "Class" for a class body. */
export function codeButtonWord(level: HierarchyLevel): string {
  return level === "file" ? "File" : level === "class" ? "Class" : "Code";
}

/** The same thing spelled for an aria-label, where the button word reads too terse. */
export function codeNoun(level: HierarchyLevel): string {
  return level === "file" ? "full file" : level === "class" ? "class" : "code";
}
