import { describe, it, expect } from "vitest";
import { bytesToHex, hexToBytes, type Address } from "viem";
import { deriveWalletKey } from "../../src/wallet/crypto/derive-wallet.js";
import {
  deriveSlotWrappingKeyBits,
  serializeBlob,
  encryptKeyBlobWithWrappingKey,
} from "../../src/wallet/crypto/blob.js";
import { deriveSlotId, encodeAccessHandle } from "../../src/wallet/passkey/label.js";
import { computeSas } from "../../src/wallet/pairing.js";
import { getPrfSalt } from "../../src/wallet/crypto/derive-wallet.js";

/**
 * CONFORMANCE TO THE STANDARD — Avok is an implementation, not the owner.
 *
 * `test/vectors/passkey-access-vault.json` is a VERBATIM COPY of the standard's conformance corpus
 * (the neutral `passkey-access-vault` repo, CC0). It is vendored, not derived: nothing in this
 * repository generates it, so this suite cannot quietly re-bless a drift the way a self-generated
 * fixture would.
 *
 * These bytes are the definition of interoperating. An implementation that reproduces them reaches the
 * same wallets as every other implementation that does — and one that does not, does not, however
 * correct its own code looks in isolation.
 *
 * 🔴 IF ONE OF THESE GOES RED, THE CODE IS WRONG. NOT THE VECTOR.
 * Every value here is load-bearing on chain. Changing any of them turns every existing wallet into a
 * different wallet and every blob already written into undecryptable bytes. There is no migration,
 * because nobody — including us — can rewrite a blob that is already in chain history.
 *
 * ── WHY VALUES, AND NOT JUST PROPERTIES (measured, not assumed) ─────────────────────────────────────
 *
 * Every other test of `deriveWalletKey` asserts a PROPERTY — it is deterministic, it is 32 bytes, a
 * different PRF gives a different key, it is not the raw PRF. All four remain true if you change
 * `hash: "SHA-256"` to `"SHA-512"`, or swap the salt and the info, or ask for 512 bits and truncate.
 *
 * MEASURED: making that one-word change to the hash turned every wallet key in existence into a
 * different key, and all 176 wallet-core tests stayed green.
 *
 * Pinning the domain STRINGS is not enough either, because the strings are only some of the
 * derivation's inputs. The parameters are inputs too. The only thing that pins a derivation is its
 * OUTPUT — which is what this file, and the corpus it reads, exist to do.
 */
import { hkdfSync } from "node:crypto";
import vectors from "./vectors/passkey-access-vault.json" with { type: "json" };
const V = vectors as any;

const ab = (h: string) => hexToBytes(h as `0x${string}`).buffer.slice(0) as ArrayBuffer;

describe("conformance: Avok reproduces the standard's test vectors", () => {
  it("the PRF salt — the FIRST input to the entire key chain", () => {
    expect(new TextDecoder().decode(getPrfSalt())).toBe(V.constants.prfSalt);
  });

  it("K = HKDF(PRF)", async () => {
    const K = await deriveWalletKey(ab(V.walletKey.prf));
    expect(bytesToHex(K)).toBe(V.walletKey.k);
  });

  /**
   * The same vector, recomputed by a COMPLETELY INDEPENDENT HKDF (node's `crypto.hkdfSync`) rather
   * than the WebCrypto path the implementation uses. The two share no code, so agreement is evidence
   * rather than circularity.
   *
   * WHY this is not redundant with the case above: that one pins the OUTPUT; this one pins the
   * CONSTRUCTION as plain RFC 5869 HKDF-SHA256 with (salt = hkdfSalt, info = walletInfo, L = 32) —
   * which is precisely what a second vendor must implement. A swapped salt/info, a different hash, or
   * a different length makes these two disagree.
   *
   * Inputs come from the vector file, not from constants of ours: if the standard's corpus and our
   * derivation ever part company, this must fail rather than quietly agree with itself.
   */
  it("K agrees with an INDEPENDENT RFC 5869 HKDF-SHA256 — the construction is the standard one", async () => {
    const ours = await deriveWalletKey(ab(V.walletKey.prf));
    const theirs = new Uint8Array(
      hkdfSync(
        "sha256",
        hexToBytes(V.walletKey.prf as `0x${string}`),
        Buffer.from(V.constants.hkdfSalt, "utf8"),
        Buffer.from(V.constants.walletInfo, "utf8"),
        32,
      ),
    );
    expect(bytesToHex(ours)).toBe(bytesToHex(theirs));
  });

  it("slotId = keccak256(address ‖ credentialId)", () => {
    expect(deriveSlotId(V.slotId.address as Address, V.slotId.credentialId)).toBe(V.slotId.slotId);
  });

  it("W = HKDF(PRF, info = slot-key ‖ address ‖ slotId)", async () => {
    const W = await deriveSlotWrappingKeyBits(
      ab(V.slotWrappingKey.prf),
      V.slotWrappingKey.address as Address,
      V.slotWrappingKey.credentialId,
    );
    expect(bytesToHex(W)).toBe(V.slotWrappingKey.w);
  });

  it("the blob is version ‖ iv ‖ AES-GCM(W, K), exactly 61 bytes", async () => {
    // Avok's sealer generates a random iv (as it must), so the ciphertext cannot be compared against a
    // fixed vector directly. Reproduce AES-GCM with the vector's FIXED iv to compare the bytes, then
    // assert Avok's own sealer agrees on the envelope length.
    const key = await crypto.subtle.importKey("raw", ab(V.blob.w), { name: "AES-GCM" }, false, ["encrypt"]);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ab(V.blob.iv) }, key, ab(V.blob.k));
    const bytes = new Uint8Array(61);
    bytes[0] = 0;
    bytes.set(hexToBytes(V.blob.iv as `0x${string}`), 1);
    bytes.set(new Uint8Array(ct), 13);
    expect(bytesToHex(bytes)).toBe(V.blob.serialized);

    const ours = await encryptKeyBlobWithWrappingKey({
      container: { key: hexToBytes(V.blob.k as `0x${string}`) },
      wrappingKey: hexToBytes(V.blob.w as `0x${string}`),
    });
    expect(serializeBlob(ours).length).toBe(V.blob.lengthBytes);
  });

  it("the access-key user handle is [0x02][address][BE chainId]", () => {
    expect(
      bytesToHex(encodeAccessHandle(V.userHandle.access.address as Address, V.userHandle.access.anchorChainId)),
    ).toBe(V.userHandle.access.encoded);
  });

  it("the enrolment SAS", async () => {
    const sas = await computeSas(
      hexToBytes(V.sas.bPub as `0x${string}`),
      hexToBytes(V.sas.aPub as `0x${string}`),
      V.sas.nonce,
    );
    expect(sas).toBe(V.sas.sas);
  });

  it("the ERC-7201 storage root matches the one the contracts pin", () => {
    // If this ever drifts, an account that re-delegated between implementations would find its access slots
    // reinterpreted at whatever those storage positions mean in the new contract.
    expect(V.erc7201.storageRoot).toBe("0xa4fa4294098059eabd10052f01eef3d8d7de7be8acc14248ecb1c1794a130600");
    expect(V.erc7201.namespace).toBe("passkey-access-vault.main");
  });
});
