import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bundle } from "sigstore";
import { fetchAttestation, subjectDigestHex, verifyAttestation } from "./attestation";

const verifyMock = vi.hoisted(() => vi.fn());
vi.mock("sigstore", () => ({ verify: verifyMock }));

/** A valid-enough bundle shape for tests: a DSSE envelope carrying an in-toto statement. */
function bundleWithSubject(sha256: string): Bundle {
  const payload = Buffer.from(
    JSON.stringify({ subject: [{ name: "codechroma", digest: { sha256 } }] }),
  ).toString("base64");
  return {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: { tlogEntries: [], content: { $case: "x509CertificateChain", certificates: [] } },
    dsseEnvelope: { payload, payloadType: "application/vnd.in-toto+json", signatures: [] },
  } as unknown as Bundle;
}

beforeEach(() => {
  verifyMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subjectDigestHex", () => {
  it("reads the sha256 subject digest from the bundle's in-toto statement", () => {
    expect(subjectDigestHex(bundleWithSubject("a".repeat(64)))).toBe("a".repeat(64));
  });

  it("returns null when the bundle has no dsse envelope", () => {
    const bundle = { mediaType: "x", verificationMaterial: {}, messageSignature: {} } as unknown as Bundle;
    expect(subjectDigestHex(bundle)).toBeNull();
  });

  it("returns null when the subject is missing a sha256 digest", () => {
    const payload = Buffer.from(JSON.stringify({ subject: [{}] })).toString("base64");
    const envelope = { payload, payloadType: "application/vnd.in-toto+json", signatures: [] };
    const bundle = { messageSignature: {}, verificationMaterial: {}, dsseEnvelope: envelope } as unknown as Bundle;
    expect(subjectDigestHex(bundle)).toBeNull();
  });
});

describe("verifyAttestation", () => {
  it("resolves when the signature verifies and the subject matches the artifact digest", async () => {
    verifyMock.mockResolvedValue(undefined);
    await expect(verifyAttestation(bundleWithSubject("a".repeat(64)), "a".repeat(64))).resolves.toBeUndefined();
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the subject digest does not match the artifact digest", async () => {
    verifyMock.mockResolvedValue(undefined);
    await expect(verifyAttestation(bundleWithSubject("a".repeat(64)), "b".repeat(64))).rejects.toThrow(
      /does not vouch/,
    );
  });

  it("propagates a signature-chain failure", async () => {
    verifyMock.mockRejectedValue(new Error("signature verification failed"));
    await expect(verifyAttestation(bundleWithSubject("a".repeat(64)), "a".repeat(64))).rejects.toThrow(
      /signature verification failed/,
    );
  });
});

describe("fetchAttestation", () => {
  const bundle = bundleWithSubject("a".repeat(64));

  it("returns the first attestation bundle on a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ attestations: [{ bundle }] }) })) as unknown as typeof fetch,
    );
    await expect(fetchAttestation("a".repeat(64))).resolves.toBe(bundle);
  });

  it("throws when the API responds non-2xx (e.g. no attestation published)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch);
    await expect(fetchAttestation("a".repeat(64))).rejects.toThrow(/no attestation/);
  });

  it("throws when the response has no bundle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ attestations: [] }) })) as unknown as typeof fetch,
    );
    await expect(fetchAttestation("a".repeat(64))).rejects.toThrow(/no signed provenance bundle/);
  });
});
