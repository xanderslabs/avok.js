import { describe, expect, test } from "vitest";
import * as api from "../../src/wallet/index.js";

describe("public API", () => {
  test("exports the D8 surface", () => {
    for (const name of [
      "createWallet",
      "createDeviceEnrollmentRequest",
      "verifyDeviceEnrollmentRequest",
      "withWalletKey",
      "withDiscoveredKeys",
      "withNewPasskeyKey",
      "signMessage",
      "signTypedData",
      "signSiwe",
      "WebAuthnPasskeyAdapter",
      "createReactNativePasskeyAdapter",
      "bytesToBase64Url",
      "base64UrlToBytes",
    ]) {
      expect(api).toHaveProperty(name);
    }
    for (const gone of [
      // Pre-D8 PRF-blob/SAS enrolment machinery — superseded by device-enrollment.ts.
      "addPasskey",
      "exportWallet",
      "reconstructWalletState",
      "resolveBlob",
      "buildAddAccessSlotCall",
      "buildRemoveAccessSlotCall",
      "deriveSlotId",
      "encodeAccessHandle",
      "encodeFoundingHandle",
      "decodeUserHandle",
      "listAccessSlots",
      "ACCESS_VAULT_ABI",
      "vaultForChainFromRegistry",
      "readAccessSlotRpId",
      "VaultUnreadableError",
      // Older prunes that predate D8 and never came back.
      "addressLabel",
      "importWallet",
      "authorizeWalletDelegation",
      "buildIntentTypedData",
      "signWalletIntent",
      "createKeySandbox",
      "beginDeviceProvisioning",
      "withWalletPrivateKey",
      "withDecryptedContainer",
      "withWalletKeyAndContainer",
      // v1 is EVM-only: K IS the EVM key, so there is no second curve to sign with.
      "withSolanaKey",
      "produceSolanaKey",
      "deriveSolanaKey",
      "solanaAddressFromSecret",
    ]) {
      expect(api).not.toHaveProperty(gone);
    }
  });

  test("does NOT re-export low-level crypto internals from the public `/wallet` subpath", () => {
    // These exist and are used INSIDE wallet/ via deep imports, but exposing key-derivation
    // primitives (and the raw HKDF domain + PRF-salt constants) on a public subpath is a footgun.
    for (const internal of ["WALLET_INFO", "HKDF_SALT", "getPrfSalt", "NoPrfError"]) {
      expect(api).not.toHaveProperty(internal);
    }
  });
});
