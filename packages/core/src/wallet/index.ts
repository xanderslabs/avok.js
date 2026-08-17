// This barrel is the internal API boundary for non-wallet core code AND the public `@avokjs/core/wallet`
// subpath. It intentionally does NOT re-export the low-level crypto primitives (the HKDF domain/salt
// constants, per-credential key derivation): those are wallet-internal, reached via deep imports
// inside this folder, and exposing key-derivation on a public subpath is a footgun. Add a symbol here
// only when a cross-module consumer needs it.
export { bytesToBase64Url, base64UrlToBytes, bytesToArrayBuffer } from "./encoding.js";

export { deriveWalletKey } from "./crypto/derive-wallet.js";

export type {
  PasskeyAdapter,
  PasskeyRegistration,
  PasskeySlot,
  DiscoveredPasskey,
  PasskeyPrfProfile,
  PasskeyPlatformMetadata,
} from "./passkey/adapter.js";

export type { WalletState } from "./sandbox.js";
export { withDiscoveredKeys, withWalletKey, withNewPasskeyKey } from "./sandbox.js";

export type { AvokAccount, BirthResult } from "./wallet.js";
export { createWallet } from "./wallet.js";

export type { DeviceEnrollmentRequest } from "./device-enrollment.js";
export { createDeviceEnrollmentRequest, verifyDeviceEnrollmentRequest } from "./device-enrollment.js";

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
