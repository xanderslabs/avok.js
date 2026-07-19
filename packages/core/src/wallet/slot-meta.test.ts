import { describe, expect, test } from "vitest";
import { hexToBytes, type Hex } from "viem";
import { encryptSlotMeta, decryptSlotMeta } from "./crypto/slot-meta.js";
import { deriveWalletKey } from "./crypto/derive-wallet.js";

const K = hexToBytes("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318");
const OTHER_K = hexToBytes("0x0f1e2d3c4b5a69788796a5b4c3d2e1f0f1e2d3c4b5a69788796a5b4c3d2e1f00");
const SLOT_A = `0x${"a1".repeat(32)}` as Hex;
const SLOT_B = `0x${"b2".repeat(32)}` as Hex;

describe("crypto/slot-meta", () => {
  test("round-trips the rp-id", async () => {
    const bytes = await encryptSlotMeta(K, SLOT_A, "wallet.example.io");
    expect(await decryptSlotMeta(K, SLOT_A, bytes)).toEqual({ rpId: "wallet.example.io" });
  });

  test("the cleartext rp-id never appears in the ciphertext", async () => {
    const bytes = await encryptSlotMeta(K, SLOT_A, "sketchy.xyz");
    expect(new TextDecoder().decode(bytes)).not.toContain("sketchy");
  });

  test("ciphertext is a CONSTANT size regardless of rp-id length (no length leak)", async () => {
    const short = await encryptSlotMeta(K, SLOT_A, "a.io");
    const long = await encryptSlotMeta(K, SLOT_A, "much-longer-subdomain.example.co.uk");
    expect(short.length).toBe(long.length);
  });

  test("a different wallet key cannot read it", async () => {
    const bytes = await encryptSlotMeta(K, SLOT_A, "foo.com");
    await expect(decryptSlotMeta(OTHER_K, SLOT_A, bytes)).rejects.toThrow();
  });

  test("metadata is bound to its access slot (wrong slotId fails the AAD check)", async () => {
    const bytes = await encryptSlotMeta(K, SLOT_A, "foo.com");
    await expect(decryptSlotMeta(K, SLOT_B, bytes)).rejects.toThrow();
  });

  test("rejects an unknown version rather than misparsing it", async () => {
    const bytes = await encryptSlotMeta(K, SLOT_A, "foo.com");
    bytes[0] = 9;
    await expect(decryptSlotMeta(K, SLOT_A, bytes)).rejects.toThrow(/version/i);
  });

  /**
   * THE STRUCTURAL SAFETY PROPERTY. The metadata key is HKDF(K, …); the wallet key is HKDF(prf, …).
   * Because the input key material differs, the metadata key cannot equal K even if the info string
   * were identical to WALLET_INFO — that would require HKDF(K, …) == K. The ciphertext must not
   * contain the raw key bytes under any framing.
   */
  test("the metadata ciphertext never contains the wallet key bytes", async () => {
    const prf = new Uint8Array(32).fill(9).buffer;
    const walletKey = await deriveWalletKey(prf);
    const bytes = await encryptSlotMeta(walletKey, SLOT_A, "foo.com");
    expect(Buffer.from(bytes).includes(Buffer.from(walletKey))).toBe(false);
  });

  test("rejects an rp-id too long to fit the fixed plaintext", async () => {
    await expect(encryptSlotMeta(K, SLOT_A, "x".repeat(200))).rejects.toThrow(/too long/i);
  });

  /**
   * THE LIMIT, pinned deliberately. The fixed plaintext is 64 bytes — 1 length byte + up to 63 bytes
   * of rp-id — because a constant size is what stops the ciphertext leaking the domain name's length.
   * 63 bytes covers every realistic rp-id (a long one like
   * "wallet.staging.some-long-company.example.co.uk" is 45), and raising the pad to fit pathological
   * domains would cost ~44k gas on EVERY access-slot write for two more cold storage words.
   *
   * The trade is therefore explicit: an operator whose rp-id exceeds 63 bytes cannot enrol, and finds
   * out immediately and loudly rather than silently losing the roster metadata. If that ever becomes a
   * real domain rather than a hypothetical one, the fix is a v1 metadata layout, not a silent truncation.
   */
  test("accepts an rp-id at the 63-byte boundary and rejects it at 64", async () => {
    const at = "a".repeat(63);
    const over = "a".repeat(64);
    expect(await decryptSlotMeta(K, SLOT_A, await encryptSlotMeta(K, SLOT_A, at))).toEqual({ rpId: at });
    await expect(encryptSlotMeta(K, SLOT_A, over)).rejects.toThrow(/too long/i);
  });

  test("a realistically long rp-id fits", async () => {
    const rpId = "wallet.staging.some-long-company.example.co.uk";
    expect(await decryptSlotMeta(K, SLOT_A, await encryptSlotMeta(K, SLOT_A, rpId))).toEqual({ rpId });
  });
});
