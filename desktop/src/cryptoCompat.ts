import crypto from "node:crypto";

const DIGEST_BY_CURVE: Record<string, string> = { prime256v1: "sha256", secp384r1: "sha384" };

/** Electron's BoringSSL has no default digest for EC keys, which tuf-js relies on; supply one by curve. */
export function installEcdsaDigestShim(target: { verify: typeof crypto.verify } = crypto): void {
  const original = target.verify;
  target.verify = ((algorithm, data, key, signature, callback) => {
    if (algorithm == null) {
      try {
        const inner = (key as { key?: unknown }).key;
        const keyObject = key instanceof crypto.KeyObject ? key
          : inner instanceof crypto.KeyObject ? inner
          : crypto.createPublicKey(key as crypto.PublicKeyInput);
        if (keyObject.asymmetricKeyType === "ec") {
          algorithm = DIGEST_BY_CURVE[keyObject.asymmetricKeyDetails?.namedCurve ?? ""] ?? algorithm;
        }
      } catch {}
    }
    return (original as (...args: unknown[]) => boolean)(algorithm, data, key, signature, callback);
  }) as typeof crypto.verify;
}
