import { verify as verifySignature } from "sigstore";
import type { Bundle } from "sigstore";

export const ATTESTATIONS_API = `https://api.github.com/repos/gutzerk/code_chroma/attestations/sha256`;

/**
 * OIDC issuer of the short-lived GitHub Actions token that signed each installer's attestation.
 * Pinning issuer + identity is what binds the provenance to *this* repo's release workflow, so a
 * compromised pipeline can't substitute an attestation signed by anything else.
 */
const ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";
// Pinned to refs/heads/main because the build jobs attest in the same main-triggered run that
// creates the tag; the upload's OIDC ref is the branch, not the tag it just created.
const WORKFLOW_IDENTITY =
  "https://github.com/gutzerk/code_chroma/.github/workflows/release-please.yml@refs/heads/main";

/** The `/attestations/sha256:{digest}` REST response (kept loose — GitHub may add fields). */
interface AttestationsResponse {
  attestations?: { bundle?: Bundle }[];
}

/**
 * Fetches the signed provenance bundle for the artifact whose SHA-256 is `hex`. Throws when the
 * release has no attestation (an unverified install must not proceed).
 */
export async function fetchAttestation(hex: string): Promise<Bundle> {
  const response = await fetch(`${ATTESTATIONS_API}:${hex}`, {
    headers: { "User-Agent": "code-chroma-desktop" },
  });
  if (!response.ok) throw new Error(`no attestation for release artifact (${response.status})`);
  const { attestations } = (await response.json()) as AttestationsResponse;
  const bundle = attestations?.[0]?.bundle;
  if (!bundle) throw new Error("release artifact has no signed provenance bundle");
  return bundle;
}

/**
 * The SHA-256 hex the bundle's in-toto statement vouches for, or null when the bundle simply has no
 * usable sha256 subject. Throws on a malformed envelope so an unexpected bundle shape isn't silently
 * downgraded to "no digest".
 */
export function subjectDigestHex(bundle: Bundle): string | null {
  const payload = bundle.dsseEnvelope?.payload;
  if (!payload) return null;
  const statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
    subject?: { digest?: { sha256?: unknown } }[];
  };
  const digest = statement?.subject?.[0]?.digest?.sha256;
  return typeof digest === "string" ? digest : null;
}

/**
 * Verifies the signed bundle came from this repo's release workflow and that it vouches for the
 * artifact with SHA-256 `artifactSha256`. Throws on any mismatch or signature-chain failure.
 */
export async function verifyAttestation(bundle: Bundle, artifactSha256: string): Promise<void> {
  await verifySignature(bundle, {
    certificateIssuer: ACTIONS_ISSUER,
    certificateIdentityURI: WORKFLOW_IDENTITY,
  });
  const vouched = subjectDigestHex(bundle);
  if (vouched !== artifactSha256) {
    throw new Error("signed attestation does not vouch for the downloaded artifact");
  }
}
