import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { BLOB_VERSION, decryptKeyBlob, encryptKeyBlob } from "./crypto/blob.js";
import type { SecretContainer } from "./crypto/container.js";

const ADDR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" as const;
const CRED = "Y3JlZA";
const prf = new Uint8Array(32).fill(7).buffer;
const base = {
  address: ADDR,
  credentialId: CRED,
  prfOutput: prf,
};

describe("blob container payload", () => {
  it("round-trips a seed-only container and stamps the current blob version", async () => {
    const container: SecretContainer = { key: hexToBytes("0x0000000000000000000000000000000000000000000000000000000000000000") };
    const blob = await encryptKeyBlob({ ...base, container });
    expect(blob.version).toBe(BLOB_VERSION);
    expect(await decryptKeyBlob(blob, prf, ADDR, CRED)).toEqual(container);
  });

  it("rejects decrypting a mis-versioned blob", async () => {
    const blob = await encryptKeyBlob({ ...base, container: { key: hexToBytes("0x0000000000000000000000000000000000000000000000000000000000000000") } });
    const tampered = { ...blob, version: 3 as unknown as typeof BLOB_VERSION };
    await expect(decryptKeyBlob(tampered, prf, ADDR, CRED)).rejects.toThrow(/version/i);
  });
});
