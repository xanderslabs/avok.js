import { describe, expect, test } from "vitest";
import * as api from "../../src/wallet/index.js";

describe("public API", () => {
  test("exposes no 'backup' vocabulary", () => {
    // A wallet has N independent access paths to one key, not a primary plus copies. The old word
    // implied a hierarchy that does not exist and would have misled every implementer of the
    // standard.
    const exported = Object.keys(api).join(" ").toLowerCase();
    expect(exported).not.toContain("backup");
  });

  test("exports the System-1 surface and none of the pruned names", () => {
    for (const name of [
      "createWallet", "addPasskey", "exportWallet",
      "withWalletKey", "withSolanaKey", "reconstructWalletState",
      "signMessage", "signTypedData", "signSiwe",
      "resolveBlob", "buildAddAccessSlotCall",
      "deriveSlotId", "encodeAccessHandle", "decodeUserHandle",
      "WebAuthnPasskeyAdapter", "createReactNativePasskeyAdapter",
      "bytesToBase64Url", "base64UrlToBytes",
    ]) {
      expect(api).toHaveProperty(name);
    }
    for (const gone of ["addressLabel", "importWallet", "authorizeWalletDelegation", "buildIntentTypedData", "signWalletIntent", "createKeySandbox", "beginDeviceProvisioning", "withWalletPrivateKey"]) {
      expect(api).not.toHaveProperty(gone);
    }
  });

  test("does NOT re-export low-level crypto internals from the public `/wallet` subpath", () => {
    // These exist and are used INSIDE wallet/ via deep imports, but exposing key-derivation / blob-seal
    // primitives (and the raw HKDF domain + PRF-salt constants) on a public subpath is a footgun. They
    // were deliberately dropped from the barrel; a re-add should trip this guard, not slip in silently.
    for (const internal of [
      "encryptKeyBlob", "encryptKeyBlobWithWrappingKey", "deriveSlotWrappingKeyBits",
      "encryptSlotMeta", "decryptSlotMeta", "computeSas",
      "encodeFoundingHandle", "handleLabel",
      "WALLET_INFO", "SLOT_META_INFO", "PAIRING_INFO_PREFIX", "getPrfSalt",
      "BLOB_VERSION", "SUPPORTED_BLOB_VERSIONS", "WRAPPING_KEY_BYTES", "isSupportedBlobVersion",
      "SLOT_META_VERSION", "NoPrfError",
    ]) {
      expect(api).not.toHaveProperty(internal);
    }
  });
});


/**
 * REMOVING AN ACCESS SLOT IS AIMABLE — and it is HOUSEKEEPING, NOT A SECURITY CONTROL.
 *
 * It became aimable when the vault gained an enumerable index and a per-slot enrollment date: a
 * wallet can list its access slots, show each one's date, and close the one the user picks.
 *
 * What it does: deletes the slot's ciphertext and FREES THE SLOT. That is why the function exists —
 * MAX_ACCESS_SLOTS is bounded, so without it a wallet that fills its slots could never enrol another
 * passkey.
 *
 * What it does NOT do, and this is the part an implementation must never dress up:
 *  - it cannot un-learn K (to SIGN, a passkey must hold K in memory; a device that ever logged in could
 *    have kept it),
 *  - it cannot erase the blob (public calldata, in chain history forever, kept by every full node),
 *  - it cannot be aimed by the honest party (every passkey signs as the same K; ANY passkey can close ANY
 *    other).
 *
 * If a device is compromised, MOVE THE FUNDS. Nothing else is sufficient.
 *
 * No exported name may say "revoke".
 */
describe("removal is aimable but is not revocation", () => {
  test("exports the removal builder and the roster", async () => {
    const mod = await import("../../src/wallet/index.js");
    expect(Object.keys(mod)).toContain("buildRemoveAccessSlotCall");
    expect(Object.keys(mod)).toContain("listAccessSlots");
  });

  test("no exported name claims revocation", async () => {
    const mod = await import("../../src/wallet/index.js");
    for (const forbidden of ["revokeDevice", "revokeAccessSlot", "revoke"]) {
      expect(Object.keys(mod)).not.toContain(forbidden);
    }
  });

  test("the ABI exposes removal and enumeration", async () => {
    const { ACCESS_VAULT_ABI } = await import("../../src/wallet/vault.js");
    const names = (ACCESS_VAULT_ABI as readonly { name?: string }[]).map((f) => f.name);
    expect(names).toContain("removeAccessSlot");
    expect(names).toContain("getAccessSlotIds");
  });
});
