/** The one place the release repo, pinned signing identity and update cadence are defined. */
export const REPO = "gutzerk/code_chroma";
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const DOWNLOAD_BASE = `${REPO_URL}/releases/latest/download`;
export const ATTESTATIONS_API = `https://api.github.com/repos/${REPO}/attestations/sha256`;
export const USER_AGENT = "code-chroma-desktop";

/** OIDC issuer of the GitHub Actions token that signs each installer's attestation. */
export const ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";
/** Pinned to refs/heads/main: the build jobs attest in the same main-triggered run that creates the tag. */
export const WORKFLOW_IDENTITY = `${REPO_URL}/.github/workflows/release-please.yml@refs/heads/main`;

/** How often the app re-checks for a release while running. */
export const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000;
/** A window-focus event triggers a check only when the last one is at least this old. */
export const FOCUS_MIN_GAP_MS = 60 * 60 * 1000;

/** True only for an https github.com release-asset URL inside `REPO` (no credentials, no look-alike hosts). */
export function isReleaseDownloadUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password
    && url.pathname.startsWith(`/${REPO}/releases/`) && url.pathname.includes("/download/");
}
