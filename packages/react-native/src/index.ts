/**
 * @avokjs/react-native — React Native facade for Avok.
 *
 * Exports:
 *   - AvokProvider + all hooks (same surface as @avokjs/react, no DOM).
 *   - createOwnOriginConnection — wires the native passkey adapter + SecureStore.
 *   - secureStoreStorage — platform-resolved StorageAdapter.
 *
 * BOTH POSTURES SHIP. Own-origin for apps that own their rpId domain; shared-origin, over a native
 * in-app browser session, for apps that do not.
 *
 * That second one was long believed impossible here. #8 deleted an earlier native auth-session
 * channel (ASWebAuthenticationSession / Custom Tabs) because it had never worked, and the note left
 * behind concluded the platform forbade it. The conclusion outlived its evidence — the commit
 * explaining WHY it failed was destroyed in a history squash — and it was wrong.
 *
 * MEASURED ON DEVICE, 2026-07-20: a WebAuthn ceremony with the PRF extension — the whole basis of
 * `K = HKDF(PRF(credential, rpId))` — evaluates successfully inside BOTH iOS
 * ASWebAuthenticationSession and Android Chrome Custom Tabs. PRF returns key material in both. The
 * shared-origin architecture is therefore reproducible on native: open the operator's origin in an
 * in-app browser tab, let the ceremony run in a context that genuinely IS that origin (which is the
 * entire point — the app cannot host .well-known files for a domain it does not own), and return
 * only the result.
 *
 * That result is not documented anywhere. No vendor publishes a per-context PRF matrix, no spec
 * covers it, and none of the nine embedded-wallet SDKs surveyed (Privy, Turnkey, Para, Dynamic,
 * Web3Auth, Coinbase, Lit, Clave, Magic) uses the PRF extension at all — they keep the secret
 * elsewhere and use the passkey only to authenticate. The public record is empty because nobody is
 * doing this, not because it fails. It was established by running the ceremony on real hardware.
 *
 * RFC 8252 §6 endorses this shape and names both APIs; §8.12 forbids the embedded-WebView
 * alternative. ASWebAuthenticationSession is one-shot — request → redirect, no postMessage — so the
 * result returns through the callback URL, and is therefore never trusted on arrival: an authorize
 * carries a signature over the caller's nonce (see @avokjs/core/channel authorize-proof).
 *
 * Peer deps: react, react-native, expo-secure-store (all injected; not static).
 * No DOM imports in this graph.
 */
import { createOwnOriginConnection as sdkCreateOwnOrigin } from "@avokjs/core/engine";
import type { StorageAdapter, SelfCustodyConnection, Connection } from "@avokjs/core/engine";
import type { ChainId } from "@avokjs/contracts";
import type { ReactNativePasskeyLike } from "@avokjs/core/wallet";
import { createSharedOriginConnection as sdkCreateSharedOrigin } from "@avokjs/core/engine";
import {
  createNativeChannel as sdkCreateNativeChannel,
  type AuthSessionOpener as AuthSessionOpenerType,
} from "@avokjs/core/channel";
import { buildNativePasskeyAdapter } from "./native-platform.js";
import { secureStoreStorage } from "./native-storage.js";

// ─── Re-exports ───────────────────────────────────────────────────────────────

// createAvokClient is the RN provider-wiring (symmetric with @avokjs/react): takes the operator's
// WalletInfo and exposes getEip1193Provider(). The browser-only announce is window-gated inside.
export { createAvokClient } from "./provider-wiring.js";
export type { WiredAvokClient } from "./provider-wiring.js";
export type {
  StorageAdapter,
  Connection,
  Account,
  ClientConfig,
  CreateOpts,
  ContinueOpts,
  UseOnlyAvokClient,
  FullAvokClient,
  AvokClientFor,
  SelfCustodyConnection,
  TxOpts,
  SolanaTxOpts,
  SolanaSimulation,
  FeeToken,
  EvmFeeToken,
  WalletInfo,
} from "@avokjs/core/engine";

// Catchable error types (values, so an app can `instanceof`-narrow without a second import). Mirrors
// @avokjs/react. MissingRpIdError is intentionally absent (fail-fast config error, not runtime-catchable).
export {
  UnsupportedFeeTokenError,
  SponsorshipUnavailableError,
  UserRejectedError,
  NoPrfError,
  KoraRejectedError,
  EnrolmentUnaffordableError,
  VaultUnreadableError,
  OrphanedCredentialError,
  SlotUnreachableError,
  EnrolmentBlockedError,
} from "@avokjs/core/engine";

export type {
  ReactNativePasskeyLike,
  ReactNativePasskeyCreateResult,
  ReactNativePasskeyGetResult,
} from "@avokjs/core/wallet";

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

// ─── Shared-origin (native) ───────────────────────────────────────────────────────────────────────
//
// The rail for apps that do NOT own the wallet's rpId domain — which is the whole reason shared-origin
// exists, and it is the same constraint on native as on web: an app cannot host /.well-known files for
// someone else's domain, so the ceremony must run somewhere that genuinely IS that origin.
//
// It was long believed impossible here. #8 deleted an earlier native channel for never having worked,
// and the note left behind concluded the platform forbade it. Measured on device 2026-07-20: a
// WebAuthn ceremony with the PRF extension — the basis of K = HKDF(PRF(credential, rpId)) — succeeds
// inside BOTH iOS ASWebAuthenticationSession and Android Chrome Custom Tabs. RFC 8252 §6 endorses this
// shape and names both APIs.
export { createNativeChannel, AuthSessionCancelledError } from "@avokjs/core/channel";
export type { AuthSessionOpener } from "@avokjs/core/channel";

/**
 * Build a shared-origin connection over a native in-app browser session.
 *
 * `openAuthSession` is injected so this package stays free of a hard Expo dependency — the signature
 * is deliberately `expo-web-browser`'s `openAuthSessionAsync`, so the common case is a one-liner:
 *
 * ```ts
 * import * as WebBrowser from "expo-web-browser";
 * const connection = createNativeSharedOrigin({
 *   authOrigin: "https://wallet.example.com",
 *   redirectUri: "myapp://avok-callback",
 *   openAuthSession: WebBrowser.openAuthSessionAsync,
 * });
 * ```
 *
 * The app must register `redirectUri` as a scheme it handles, or the session has nowhere to return to.
 *
 * One session per signature, matching the web popup — which also opens and closes per request, so the
 * semantics are the same rather than a native compromise.
 */
export function createNativeSharedOrigin(opts: {
  authOrigin: string;
  redirectUri: string;
  openAuthSession: AuthSessionOpenerType;
  storage?: StorageAdapter;
}): Connection {
  return sdkCreateSharedOrigin({
    authOrigin: opts.authOrigin,
    channel: sdkCreateNativeChannel({
      authOrigin: opts.authOrigin,
      redirectUri: opts.redirectUri,
      openAuthSession: opts.openAuthSession,
    }),
    ...(opts.storage ? { storage: opts.storage as never } : {}),
  });
}
