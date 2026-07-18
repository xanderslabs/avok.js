export { bytesToBase64Url, base64UrlToBytes, bytesToArrayBuffer } from "./encoding.js";
export type { UserHandle } from "./passkey/label.js";
export { deriveSlotId, encodeFoundingHandle, encodeAccessHandle, decodeUserHandle, handleLabel } from "./passkey/label.js";

export type { EncryptedKeyBlob, BlobVersion } from "./crypto/blob.js";
export {
  encryptKeyBlob,
  decryptKeyBlob,
  serializeBlob,
  deserializeBlob,
  encryptKeyBlobWithWrappingKey,
  deriveSlotWrappingKeyBits,
  isSupportedBlobVersion,
  BLOB_BYTES,
  BLOB_VERSION,
  SUPPORTED_BLOB_VERSIONS,
  WRAPPING_KEY_BYTES,
} from "./crypto/blob.js";

export { deriveWalletKey, WALLET_INFO, SLOT_META_INFO } from "./crypto/derive-wallet.js";
export { encryptSlotMeta, decryptSlotMeta, META_BYTES, SLOT_META_VERSION } from "./crypto/slot-meta.js";

export type {
  PasskeyAdapter,
  PasskeyRegistration,
  PasskeySlot,
  DiscoveredPasskey,
  PasskeyPrfProfile,
  PasskeyPlatformMetadata,
} from "./passkey/adapter.js";
export { NoPrfError } from "./passkey/adapter.js";

export type { WalletState, SolanaSigner } from "./sandbox.js";
export { withDiscoveredWalletKey, withDiscoveredSolanaKey, withDiscoveredKeys, withWalletKey, withWalletKeyAndContainer, withWalletKeyAndEvidence, withSolanaKey, withDecryptedContainer } from "./sandbox.js";
// The provisioning channel. NOTE what is NOT here: sealContainer / unsealContainer / PairGrant. The
// ceremony that shipped K to the new device is gone; K never travels. See enrolment.ts.
export {
  generateEphemeral, randomNonce, buildRequest, encodePayload, decodePayload,
  deriveSession, computeSas, PAIRING_INFO_PREFIX,
  type PairEphemeral, type PairRequest, type PairAck,
} from "./pairing.js";

// The ONE enrolment ceremony — same passkey whether the credential is on your second device or under an
// independent domain.
export type { AccessSlotOffer, AccessSlotWrap } from "./enrolment.js";
export {
  buildAck, openAck, createPasskeyCredential, repairPasskeyCredential, sealWrap, openWrap, sealAccessSlot,
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


export { WebAuthnPasskeyAdapter, MissingRpIdError, getPrfSalt } from "./passkey/web.js";
export type {
  ReactNativePasskeyLike,
  ReactNativePasskeyCreateResult,
  ReactNativePasskeyGetResult,
} from "./passkey/native.js";
export { createReactNativePasskeyAdapter } from "./passkey/native.js";

export type { AvokRegistrationEvidence, AvokAssertionEvidence } from "./webauthn-evidence.js";
export {
  serializeRegistrationEvidence,
  serializeAssertionEvidence,
  assertionEvidenceFromParts,
  registrationEvidenceFromParts,
} from "./webauthn-evidence.js";
