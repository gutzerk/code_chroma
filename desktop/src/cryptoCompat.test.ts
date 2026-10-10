import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { installEcdsaDigestShim } from "./cryptoCompat";

describe("installEcdsaDigestShim", () => {
  it("defaults the digest for an EC key when the caller passes none", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const data = Buffer.from("root");
    const signature = crypto.sign("sha256", data, privateKey);
    const calls: unknown[] = [];
    const fake = { verify: ((...args: unknown[]) => (calls.push(args[0]), true)) as typeof crypto.verify };

    installEcdsaDigestShim(fake);
    fake.verify(undefined, data, publicKey, signature);

    expect(calls).toEqual(["sha256"]);
  });

  it("leaves an explicit algorithm untouched", () => {
    const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const calls: unknown[] = [];
    const fake = { verify: ((...args: unknown[]) => (calls.push(args[0]), true)) as typeof crypto.verify };

    installEcdsaDigestShim(fake);
    fake.verify("sha512", Buffer.from("x"), publicKey, Buffer.from("y"));

    expect(calls).toEqual(["sha512"]);
  });
});

describe("installEcdsaDigestShim key wrappers", () => {
  it("unwraps the { key } object that tuf passes", () => {
    const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const calls: unknown[] = [];
    const fake = { verify: ((...args: unknown[]) => (calls.push(args[0]), true)) as typeof crypto.verify };

    installEcdsaDigestShim(fake);
    fake.verify(undefined, Buffer.from("x"), { key: publicKey } as never, Buffer.from("y"));

    expect(calls).toEqual(["sha256"]);
  });
});
