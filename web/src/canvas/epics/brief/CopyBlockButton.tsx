import { CopyButton } from "../../strategies/nodeChrome";

/** Joins a block's non-empty pieces into the exact clipboard text shown for it -- shared by every
 * `CopyBlockButton` caller so each one only picks its own pieces and separator. */
export function joinNonEmpty(parts: Array<string | null | undefined>, separator = "\n"): string {
  return parts.filter((part) => part && part.trim().length > 0).join(separator);
}

/** The copy button shown on each content block of the epic brief -- `CopyButton` under the
 * "epic-brief" variant, so the brief's blocks and the hierarchy's boxes share one flash/clipboard
 * implementation. `name` is the text itself here: a block has no separate short label to announce. */
export function CopyBlockButton({ text }: { text: string }) {
  return (
    <CopyButton text={text} name={text} variant="epic-brief" testId="epic-brief-copy-button" />
  );
}
