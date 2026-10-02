const PR_URL = /github\.com[/:][^/]+\/[^/]+?(?:\.git)?\/pull\/(\d+)/;

const BARE_NUMBER = /^#?(\d+)$/;

/** The pull-request number `input` names, or null when it names none.
 *
 * Deliberately does *not* check the owner/repo: the client doesn't know which remote the bridge has
 * open, so "that PR is in another repository" is the bridge's answer to give, surfaced as the
 * dialog's error. All this does is spare a request for input that can't be a PR at all. */
export function parsePrNumber(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  const url = PR_URL.exec(text);
  if (url) return Number(url[1]);
  const bare = BARE_NUMBER.exec(text);
  return bare ? Number(bare[1]) : null;
}
