/** The tri-state "done" checkbox glyph shared by requirements, stage items, and acceptance
 * criteria -- true/false/null (unknown) all render the same way everywhere on this canvas. */
export function doneGlyph(done: boolean | null): string {
  if (done === true) return "☑";
  if (done === false) return "☐";
  return "◇";
}
