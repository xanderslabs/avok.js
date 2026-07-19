/**
 * @avokjs/react-native — React Native facade for Avok.
 *
 * Exports:
 *   - AvokProvider + all hooks (same surface as @avokjs/react, no DOM).
 *   - createOwnOriginConnection — wires the native passkey adapter + SecureStore.
 *   - secureStoreStorage — platform-resolved StorageAdapter.
 *
 * OWN-ORIGIN ONLY. There is no shared-origin connection here: #8 deleted the native auth-session
 * channel (ASWebAuthenticationSession / Custom Tabs) because it had never worked. A native app that
 * needs shared-origin has no supported path today — do not infer one from an older comment.
 *
 * Peer deps: react, react-native, expo-secure-store (all injected; not static).
 * No DOM imports in this graph.
 */
import { createOwnOriginConnection as sdkCreateOwnOrigin } from "@avokjs/core/engine";
import type { StorageAdapter, Connection, SelfCustodyConnection } from "@avokjs/core/engine";
import type { ChainId } from "@avokjs/contracts";
import type { ReactNativePasskeyLike } from "@avokjs/core/wallet";
import { buildNativePasskeyAdapter } from "./native-platform.js";
import { secureStoreStorage } from "./native-storage.js";

// ─── Re-exports ───────────────────────────────────────────────────────────────

// createAvokClient is the RN provider-wiring (symmetric with @avokjs/react): takes the operator's
// WalletInfo and exposes getEip1193Provider(). The browser-only announce is window-gated inside.
export { createAvokClient } from "./provider-wiring.js";
export type { WiredAvokClient } from "./provider-wiring.js";
export type { StorageAdapter, Connection, Account, ClientConfig, CreateOpts, ContinueOpts, UseOnlyAvokClient, FullAvokClient, AvokClientFor, SelfCustodyConnection, TxOpts, SolanaTxOpts, SolanaSimulation, FeeToken, EvmFeeToken, WalletInfo } from "@avokjs/core/engine";

// Catchable error types (values, so an app can `instanceof`-narrow without a second import). Mirrors
// @avokjs/react. MissingRpIdError is intentionally absent (fail-fast config error, not runtime-catchable).
export {
  UnsupportedFeeTokenError,
  UserRejectedError,
  NoPrfError,
  KoraRejectedError,
  EnrolmentUnaffordableError,
  VaultUnreadableError,
  OrphanedCredentialError,
  SlotUnreachableError,
  EnrolmentBlockedError,
} from "@avokjs/core/engine";

export type { ReactNativePasskeyLike, ReactNativePasskeyCreateResult, ReactNativePasskeyGetResult } from "@avokjs/core/wallet";

export { secureStoreStorage } from "./native-storage.js";
export type { SecureStoreShape } from "./native-storage.js";

export { AvokProvider } from "./provider.js";

export {
  useAvok,
  useSelfCustody,
  useAccount,
  useCreate,
  useLogin,
  useLogout,
  // Management-verb hooks (own-origin / self-custody).
  useEnroll,
  useExport,
  useAccessSlots,
} from "./hooks.js";

// ─── Device pairing (QR ceremony — headless; transport injected) ──────────────
export { usePairingCeremony } from "./pairing.js";
export type { PairPhase, PairingCeremony } from "./pairing.js";
export { createExpoCameraTransport } from "./pairing-transport.js";
export type { ExpoCameraLike, ExpoCameraTransport } from "./pairing-transport.js";

// ─── createOwnOriginConnection ───────────────────────────────────────────────────

/**
 * Creates an own-origin passkey connection wired with the native platform trio:
 * - RN passkey adapter (`createReactNativePasskeyAdapter` from wallet-core)
 * - SecureStore-backed StorageAdapter (memory/localStorage fallback for tests)
 *
 * Device-gated: real passkey create/get require a native device with platform
 * authenticator support (Face ID, Touch ID, etc.). Unit tests assert wiring
 * (Connection verbs) only — see VERIFICATION.md for device-gated checks.
 *
 * @param opts.rpId — relying-party ID (e.g. "app.avok.fi").
 * @param opts.passkey — injected `react-native-passkey`-shaped module. Pass a
 *   fake in tests to avoid needing the real native module.
 * @param opts.storage — optional StorageAdapter override. Defaults to
 *   `secureStoreStorage()` (SecureStore on native, localStorage in RN-web).
 */
export function createOwnOriginConnection(opts: {
  rpId: string;
  passkey: ReactNativePasskeyLike;
  /** Cosmetic friendly operator name: becomes the WebAuthn `rp.name` (the OS "Sign in to …" prompt)
   *  AND the passkey wallet-label prefix ("<operatorName> Wallet · Nickname"). Defaults to the rpId
   *  domain when unset. Display only — it never affects the rpId, the PRF scope, or key material. */
  operatorName?: string;
  storage?: StorageAdapter;
  /** CAIP-2 chain where this wallet anchors its secondary-device access slots (default eip155:10). */
  anchorChainId?: ChainId;
}): SelfCustodyConnection {
  if (!opts.passkey) {
    throw new Error(
      "createOwnOriginConnection: opts.passkey (ReactNativePasskeyLike) is required. " +
        "Pass the react-native-passkey module or a fake for tests.",
    );
  }
  return sdkCreateOwnOrigin({
    rpId: opts.rpId,
    operatorName: opts.operatorName,
    passkey: buildNativePasskeyAdapter(opts.passkey, opts.rpId, opts.operatorName),
    storage: opts.storage ?? secureStoreStorage(),
    anchorChainId: opts.anchorChainId,
  });
}


