import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { stringToBytes, hexToBytes, type Address } from "viem";
import {
  deriveWalletKey,
  HKDF_SALT,
  WALLET_INFO,
  SLOT_INFO_PREFIX,
  SLOT_META_INFO,
} from "./crypto/derive-wallet.js";
import { PAIRING_INFO_PREFIX } from "./pairing.js";
import { getPrfSalt } from "./passkey/web.js";
import { encryptKeyBlob } from "./crypto/blob.js";
import { deriveSlotId } from "./passkey/label.js";
import { bytesToArrayBuffer } from "./encoding.js";
import { deserializeContainer, type SecretContainer } from "./crypto/container.js";

const prf = (fill: number) => new Uint8Array(32).fill(fill).buffer;

describe("deriveWalletKey", () => {
  it("is deterministic — the same PRF output always yields the same wallet key", async () => {
    // This is the entire durability promise: log out, log back in, same passkey, same wallet.
    expect(await deriveWalletKey(prf(7))).toEqual(await deriveWalletKey(prf(7)));
  });

  it("is a 32-byte key (mutable bytes, not an immutable hex string)", async () => {
    const key = await deriveWalletKey(prf(1));
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("separates wallets — a different PRF output yields a different key", async () => {
    expect(await deriveWalletKey(prf(1))).not.toEqual(await deriveWalletKey(prf(2)));
  });

  it("never returns the raw PRF output", async () => {
    // If K were the PRF bytes themselves, any code path that leaked a PRF evaluation would leak
    // the key in a directly recognisable form. HKDF is what stands between them.
    expect(await deriveWalletKey(prf(7))).not.toEqual(new Uint8Array(32).fill(7));
  });
});

describe("domain strings are vendor-neutral", () => {
  it("contains no vendor name", () => {
    // A standard cannot carry a vendor's name in its key derivation: a second implementer would be
    // reciting ours in their own product's crypto.
    //
    // The PRF SALT and the PAIRING INFO are in this list because they were originally MISSED — this
    // test checked only the three HKDF strings while `avok-passkey-prf-v1` sat upstream of all of
    // them, determining the PRF and therefore K itself. Every input to a derivation belongs here.
    for (const s of [HKDF_SALT, WALLET_INFO, SLOT_INFO_PREFIX, SLOT_META_INFO, PAIRING_INFO_PREFIX]) {
      expect(s.toLowerCase()).not.toContain("avok");
    }
    expect(new TextDecoder().decode(getPrfSalt()).toLowerCase()).not.toContain("avok");
  });

  /**
   * THE BACKSTOP. The list above is a list, and lists go stale — that is exactly how the PRF salt
   * slipped through. This scans the SOURCE of every module that performs a derivation and fails on any
   * vendor-named string literal, so a future `info: "avok-something"` cannot be added without a
   * conscious fight with this test.
   */
  it("no derivation module contains a vendor-named string literal at all", () => {
    const modules = [
      "../../src/wallet/crypto/derive-wallet.ts",
      "../../src/wallet/crypto/blob.ts",
      "../../src/wallet/crypto/slot-meta.ts",
      "../../src/wallet/pairing.ts",
      "../../src/wallet/enrolment.ts",
      "../../src/wallet/passkey/web.ts",
    ];
    for (const rel of modules) {
      const raw = readFileSync(join(import.meta.dirname, rel), "utf8");
      // Strip comments FIRST. An apostrophe in prose ("the wallet's key") otherwise opens a bogus
      // string literal that swallows the code after it — the scan must look at code, not prose, and
      // comments are of course free to name the product.
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      const literals = code.match(/(["'`])(?:\\.|(?!\1)[^\\])*?\1/g) ?? [];
      const offenders = literals.filter((l) => l.toLowerCase().includes("avok"));
      expect(offenders, `${rel} puts a vendor name in a string literal: ${offenders.join(", ")}`).toEqual([]);
    }
  });

  it("pins the exact wire values (changing these breaks every existing blob)", () => {
    expect(HKDF_SALT).toBe("passkey-access-vault/hkdf-salt/v0");
    expect(WALLET_INFO).toBe("passkey-access-vault/wallet-key/v0");
    expect(SLOT_INFO_PREFIX).toBe("passkey-access-vault/slot-key/v0");
    expect(PAIRING_INFO_PREFIX).toBe("passkey-access-vault/pairing-session/v0");
  });

  it("pins the PRF salt — changing it changes every K, i.e. every wallet becomes a different wallet", () => {
    // This is the FIRST input to the chain (PRF = authenticator(salt); K = HKDF(PRF)), so it is the
    // single most load-bearing constant in the standard. Frozen once real users hold value.
    expect(new TextDecoder().decode(getPrfSalt())).toBe("passkey-access-vault/prf-salt/v0");
  });

  it("keeps the wallet-key and slot-key domains apart", () => {
    expect(WALLET_INFO).not.toBe(SLOT_INFO_PREFIX);
  });

  it("pins the slot-meta domain and keeps it vendor-neutral", () => {
    expect(SLOT_META_INFO).toBe("passkey-access-vault/slot-meta-key/v0");
    expect(SLOT_META_INFO.toLowerCase()).not.toContain("avok");
  });
});

describe("domain separation between the wallet key and the blob AES key", () => {
  it("the wallet key differs from the blob AES key that provably decrypts the real ciphertext", async () => {
    // The catastrophic failure this guards: if HKDF(prf, walletInfo) ever equalled
    // HKDF(prf, blobInfo), then publishing a secondary's on-chain ciphertext would publish a
    // wallet key. The two `info` strings are the only thing keeping them apart.
    //
    // This test establishes two things, in order:
    //   (1) The independently-derived `blobKeyBits` IS the real blob AES key — not merely bytes
    //       that resemble it. We prove this by importing it as an AES-GCM key and decrypting the
    //       blob's OWN ciphertext + iv. AES-GCM authenticates: if our mirrored HKDF parameters
    //       (salt/info/hash/.toLowerCase()) drifted from deriveAesKey by even one byte, the tag
    //       check fails and crypto.subtle.decrypt throws — this line goes red, loudly. So a
    //       successful decrypt is proof the mirror reproduces deriveAesKey exactly.
    //   (2) Given (1), the wallet key provably differs from that real blob key. This is the
    //       assertion that matters; step (1) is only what makes it non-vacuous.
    //
    // `deriveAesKey` in crypto/blob.ts returns a non-extractable CryptoKey, so we cannot read its
    // bytes directly — reproducing them via deriveBits and proving equivalence by decryption is
    // how we get an extractable, comparable value.
    const prfOutput = new Uint8Array(32).fill(9).buffer;
    const address = "0x1111111111111111111111111111111111111111" as Address;
    const credentialId = "Y3JlZC0x";

    // Dummy secret: the container is a single 32-byte key K (raw bytes).
    const container: SecretContainer = {
      key: hexToBytes("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"),
    };
    const blob = await encryptKeyBlob({
      container,
      address,
      credentialId,
      prfOutput,
    });

    const walletKey = await deriveWalletKey(prfOutput);

    // Independently derive the blob's AES key MATERIAL, mirroring deriveAesKey's HKDF parameters
    // byte-for-byte (salt, hash, and the `<SLOT_INFO_PREFIX>|<address.toLowerCase()>|<slotId>`
    // info template).
    const slotId = deriveSlotId(address, credentialId);
    const blobInfo = `${SLOT_INFO_PREFIX}|${address.toLowerCase()}|${slotId}`;
    const baseKey = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveBits"]);
    const blobKeyBits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: bytesToArrayBuffer(stringToBytes(HKDF_SALT)),
        info: bytesToArrayBuffer(stringToBytes(blobInfo)),
      },
      baseKey,
      256,
    );

    // (1) Prove the mirror IS the real blob key: decrypt the blob's own ciphertext with it.
    // AES-GCM's auth tag makes this a hard equivalence check — a drifted derivation throws here.
    const aesKey = await crypto.subtle.importKey(
      "raw",
      blobKeyBits,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesToArrayBuffer(blob.iv) },
      aesKey,
      bytesToArrayBuffer(blob.ciphertext),
    );
    // The plaintext is the raw 32 key bytes (the container payload).
    expect(deserializeContainer(new Uint8Array(plaintext))).toEqual(container);

    // (2) The pin: the wallet key differs from that provably-real blob key.
    // This FAILS if WALLET_INFO is ever set equal to the blob's info string.
    expect(walletKey).not.toEqual(new Uint8Array(blobKeyBits));
  });
});
