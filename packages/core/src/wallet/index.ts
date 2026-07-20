// This barrel is the internal API boundary for non-wallet core code AND the public `@avokjs/core/wallet`
// subpath. It intentionally does NOT re-export the low-level crypto primitives (blob/slot-meta seal-open,
// the HKDF domain/salt constants, per-credential key derivation): those are wallet-internal, reached via
// deep imports inside this folder, and exposing key-derivation on a public subpath is a footgun. Add a
// symbol here only when a cross-module consumer needs it.
export { bytesToBase64Url, base64UrlToBytes, bytesToArrayBuffer } from "./encoding.js";
export type { UserHandle } from "./passkey/label.js";
export { deriveSlotId, encodeAccessHandle, decodeUserHandle } from "./passkey/label.js";

export type { EncryptedKeyBlob, BlobVersion } from "./crypto/blob.js";
export { decryptKeyBlob, serializeBlob, deserializeBlob, BLOB_BYTES } from "./crypto/blob.js";

export { deriveWalletKey } from "./crypto/derive-wallet.js";
export { META_BYTES } from "./crypto/slot-meta.js";

export type {
  PasskeyAdapter,
  PasskeyRegistration,
  PasskeySlot,
  DiscoveredPasskey,
  PasskeyPrfProfile,
  PasskeyPlatformMetadata,
} from "./passkey/adapter.js";

export type { WalletState, SolanaSigner } from "./sandbox.js";
export {
  withDiscoveredKeys,
  withWalletKey,
  withWalletKeyAndContainer,
  withSolanaKey,
  withDecryptedContainer,
} from "./sandbox.js";
// The provisioning channel. NOTE what is NOT here: sealContainer / unsealContainer / PairGrant. The
// ceremony that shipped K to the new device is gone; K never travels. See enrolment.ts.
export {
  generateEphemeral,
  randomNonce,
  buildInvite,
  encodePayload,
  decodePayload,
  deriveSession,
  type PairEphemeral,
  type PairInvite,
} from "./pairing.js";

// The ONE enrolment ceremony — same passkey whether the credential is on your second device or under an
// independent domain.
export type { AccessSlotOffer, AccessSlotWrap } from "./enrolment.js";
export {
  createPasskeyCredential,
  repairPasskeyCredential,
  sealWrap,
  openWrap,
  type PendingAccessSlotWrap,
  sealAccessSlot,
} from "./enrolment.js";

export type { AvokAccount, ExportedWallet, BirthResult } from "./wallet.js";
export {
  createWallet,
  addPasskey,
  exportWallet,
  reconstructFromKey,
  reconstructWalletState,
} from "./wallet.js";

export type { Call, VaultReader } from "./vault.js";
export { ACCESS_VAULT_ABI, buildAddAccessSlotCall, buildRemoveAccessSlotCall, VaultUnreadableError } from "./vault.js";
export { listAccessSlots } from "./roster.js";
export type { AccessSlotEntry, RosterReader } from "./roster.js";
export { readAccessSlotRpId } from "./roster-meta.js";
export { vaultForChainFromRegistry } from "./vault-registry.js";

export type { BlobSource, ResolveBlobResult } from "./resolution.js";
export { resolveBlob } from "./resolution.js";

export type { SiweParams } from "./signing.js";
export { signMessage, signTypedData, signSiwe } from "./signing.js";

export { MissingRpIdError } from "./passkey/adapter.js";
export { WebAuthnPasskeyAdapter } from "./passkey/web.js";
export type {
  ReactNativePasskeyLike,
  ReactNativePasskeyCreateResult,
  ReactNativePasskeyGetResult,
} from "./passkey/native.js";
export { createReactNativePasskeyAdapter } from "./passkey/native.js";
