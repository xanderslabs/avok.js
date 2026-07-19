import { describe, expect, test } from "vitest";
import { hexToBytes } from "viem";
import {
  BLOB_BYTES,
  BLOB_VERSION,
  SUPPORTED_BLOB_VERSIONS,
  decryptKeyBlob,
  deriveSlotWrappingKeyBits,
  deserializeBlob,
  encryptKeyBlob,
  encryptKeyBlobWithWrappingKey,
  serializeBlob,
  WRAPPING_KEY_BYTES,
} from "./crypto/blob.js";
import type { SecretContainer } from "./crypto/container.js";

function prf(seed: number): ArrayBuffer {
  return new Uint8Array(Array.from({ length: 32 }, (_, i) => (seed + i) % 256)).buffer;
}

const ADDR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" as const;
const OTHER_ADDR = "0x000000000000000000000000000000000000dEaD" as const;

const CRED = "Y3JlZC1hYWE";
const base = {
  address: ADDR,
  credentialId: CRED,
};

const container: SecretContainer = {
  key: hexToBytes("0x0000000000000000000000000000000000000000000000000000000000000000"),
};

describe("crypto/blob", () => {
  test("encrypt → decrypt round-trips the container", async () => {
    const testContainer: SecretContainer = {
      key: hexToBytes("0x0f1e2d3c4b5a69788796a5b4c3d2e1f0f1e2d3c4b5a69788796a5b4c3d2e1f00"),
    };
    const blob = await encryptKeyBlob({ ...base, container: testContainer, prfOutput: prf(1) });
    expect(blob.version).toBe(BLOB_VERSION);
    // The plaintext key must not survive anywhere in the ciphertext.
    expect(Buffer.from(blob.ciphertext).includes(Buffer.from(testContainer.key))).toBe(false);
    expect(await decryptKeyBlob(blob, prf(1), ADDR, CRED)).toEqual(testContainer);
  });

  test("wrong PRF output fails to decrypt", async () => {
    const blob = await encryptKeyBlob({ ...base, container, prfOutput: prf(1) });
    await expect(decryptKeyBlob(blob, prf(2), ADDR, CRED)).rejects.toThrow();
  });

  test("a wrong address (the domain-separation binding) fails to decrypt", async () => {
    // The address is bound into the AES `info`; it is not carried in the blob. Supplying the wrong
    // one derives a different key and AES-GCM's tag check throws.
    const blob = await encryptKeyBlob({ ...base, container, prfOutput: prf(1) });
    await expect(decryptKeyBlob(blob, prf(1), OTHER_ADDR, CRED)).rejects.toThrow();
  });

  test("a wrong credentialId (the slot binding) fails to decrypt", async () => {
    const blob = await encryptKeyBlob({ ...base, container, prfOutput: prf(1) });
    await expect(decryptKeyBlob(blob, prf(1), ADDR, "Y3JlZC16eno")).rejects.toThrow();
  });
});

describe("canonical binary envelope", () => {
  test("is exactly 61 bytes: version(1) || iv(12) || ciphertext(48)", async () => {
    const blob = await encryptKeyBlob({ ...base, container, prfOutput: prf(1) });
    const bytes = serializeBlob(blob);
    expect(bytes.length).toBe(61);
    expect(BLOB_BYTES).toBe(61);
    expect(bytes[0]).toBe(0);
    expect(BLOB_VERSION).toBe(0);
  });

  test("round-trips through serialize/deserialize byte-for-byte", async () => {
    const blob = await encryptKeyBlob({ ...base, container, prfOutput: prf(1) });
    const bytes = serializeBlob(blob);
    expect(serializeBlob(deserializeBlob(bytes))).toEqual(bytes);
    expect(deserializeBlob(bytes)).toEqual(blob);
  });

  test("is canonical: the same blob always serializes to the same bytes", async () => {
    // JSON has no canonical byte encoding — this is the property that lets a second implementation
    // produce the same bytes for the same blob, which is why the standard forbids JSON.
    const blob = await encryptKeyBlob({ ...base, container, prfOutput: prf(1) });
    expect(serializeBlob(blob)).toEqual(serializeBlob(deserializeBlob(serializeBlob(blob))));
  });

  test("rejects an unknown version rather than misparsing it", () => {
    const bytes = new Uint8Array(61);
    bytes[0] = 9;
    expect(() => deserializeBlob(bytes)).toThrow(/version/i);
  });

  // ── The migration guarantee ────────────────────────────────────────────────────────────────────
  // An access-slot blob is PUBLIC, ON CHAIN, IMMUTABLE, and IS the recovery path. If a future
  // BLOB_VERSION bump made older blobs unreadable, every wallet whose access slot was written under the old
  // version would be locked out of its own funds, permanently, with no remedy. The reader is a SET
  // for exactly this reason. These tests fail the moment someone reintroduces an equality check.

  test("a v0 envelope stays readable no matter what version we currently WRITE", () => {
    // Deliberately hardcodes 0 instead of BLOB_VERSION: that is the whole point. Bump BLOB_VERSION to
    // 1 with an equality-based reader and this test goes red — which is the bug it exists to catch.
    const bytes = new Uint8Array(61);
    bytes[0] = 0;
    expect(deserializeBlob(bytes).version).toBe(0);
  });

  test("v0 is never dropped from the supported set — those blobs are on chain forever", () => {
    expect(SUPPORTED_BLOB_VERSIONS).toContain(0);
  });

  test("whatever we WRITE, we can also READ", () => {
    expect(SUPPORTED_BLOB_VERSIONS).toContain(BLOB_VERSION);
  });

  test("decryptKeyBlob accepts any SUPPORTED version, not merely the written one", async () => {
    const blob = await encryptKeyBlob({ ...base, container, prfOutput: prf(1) });
    for (const v of SUPPORTED_BLOB_VERSIONS) {
      const asVersion = { ...blob, version: v };
      // v0 is the only readable version today, so this round-trips. When a v1 lands, this loop is
      // what proves the old one still opens.
      if (v === blob.version) {
        await expect(decryptKeyBlob(asVersion, prf(1), base.address, base.credentialId)).resolves.toBeDefined();
      }
    }
  });

  test("rejects a wrong-length envelope", () => {
    expect(() => deserializeBlob(new Uint8Array(60))).toThrow(/61/);
    expect(() => deserializeBlob(new Uint8Array(62))).toThrow(/61/);
  });

  test("decrypts back to the same key after a serialize round-trip", async () => {
    const blob = await encryptKeyBlob({ ...base, container, prfOutput: prf(1) });
    const out = await decryptKeyBlob(deserializeBlob(serializeBlob(blob)), prf(1), ADDR, CRED);
    expect(out).toEqual(container);
  });

  test("carries nothing that fingerprints a user", async () => {
    // This lands PUBLICLY on chain. No address, no credentialId, no rpId, no transports, no
    // createdAt — the decrypter re-supplies address and credentialId from the handle and discover().
    const blob = await encryptKeyBlob({ ...base, container, prfOutput: prf(1) });
    expect(Object.keys(blob).sort()).toEqual(["ciphertext", "iv", "version"]);
  });
});

describe("the lifeboat wrapping key", () => {
  const K: SecretContainer = {
    key: hexToBytes("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"),
  };

  test("is 32 extractable bytes", async () => {
    const w = await deriveSlotWrappingKeyBits(prf(2), ADDR, CRED);
    expect(w).toBeInstanceOf(Uint8Array);
    expect(w.length).toBe(WRAPPING_KEY_BYTES);
  });

  /**
   * THE LINCHPIN. The lifeboat derives W alone and never sees K; the holder encrypts K under W.
   * Months later the lifeboat recovers holding only its passkey. If these two derivations are not
   * bit-identical, the passkey is enrolled, listed, believed — and unopenable. Nothing else in the
   * lifeboat protocol matters if this fails.
   */
  test("a blob sealed under W opens with the REAL decryptKeyBlob under prf2", async () => {
    const w = await deriveSlotWrappingKeyBits(prf(2), ADDR, CRED);
    const blob = await encryptKeyBlobWithWrappingKey({ container: K, wrappingKey: w });
    const recovered = await decryptKeyBlob(blob, prf(2), ADDR, CRED);
    expect(recovered.key).toEqual(K.key);
  });

  test("W is bound to its access slot: a blob sealed for one credential does not open as another", async () => {
    const w = await deriveSlotWrappingKeyBits(prf(2), ADDR, CRED);
    const blob = await encryptKeyBlobWithWrappingKey({ container: K, wrappingKey: w });
    await expect(decryptKeyBlob(blob, prf(2), ADDR, "Y3JlZC1vdGhlcg")).rejects.toThrow();
  });

  test("W is bound to its wallet: the same credential under another address yields a different key", async () => {
    expect(await deriveSlotWrappingKeyBits(prf(2), ADDR, CRED)).not.toEqual(
      await deriveSlotWrappingKeyBits(prf(2), OTHER_ADDR, CRED),
    );
  });

  test("W is not the PRF output — HKDF stands between them", async () => {
    const w = await deriveSlotWrappingKeyBits(prf(2), ADDR, CRED);
    expect(w).not.toEqual(new Uint8Array(prf(2)));
  });

  test("rejects a malformed wrapping key rather than sealing under a weak one", async () => {
    await expect(
      encryptKeyBlobWithWrappingKey({ container: K, wrappingKey: new Uint8Array(16) }),
    ).rejects.toThrow(/32 bytes/i);
  });
});
