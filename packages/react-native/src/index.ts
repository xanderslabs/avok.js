/**
 * @avokjs/react-native — React Native facade for Avok.
 *
 * Exports:
 *   - AvokProvider + all hooks (same surface as @avokjs/react, no DOM).
 *   - createNativeSharedOrigin — the shared-origin rail over a native in-app browser session.
 *
 * D3: popup-for-all — there is no more own-origin (in-app, no-popup) custody posture. The shared-origin
 * rail works on native because the ceremony can run in an in-app browser tab that genuinely IS the
 * origin-point vault's origin, and only the result comes back. That depends on the PRF extension
 * evaluating inside the tab, which is not documented by any vendor or spec and was therefore MEASURED
 * on real hardware. VERIFICATION.md §3b is the single source of truth for that measurement, its date,
 * and how to re-run it. Do not restate the result here.
 *
 * RFC 8252 §6 RECOMMENDS the in-app browser tab for exactly this, and §8.12 says native apps
 * "MUST NOT use embedded user-agents". ASWebAuthenticationSession is one-shot — request → redirect,
 * no postMessage — so the result returns through the callback URL, and is therefore never trusted on
 * arrival: a connect carries a signature over the caller's nonce (see @avokjs/core/channel
 * authorize-proof).
 *
 * Peer deps: react, react-native, expo-secure-store (all injected; not static).
 * No DOM imports in this graph.
 */
import type { StorageAdapter, Connection } from "@avokjs/core/engine";
import { createSharedOriginConnection as sdkCreateSharedOrigin } from "@avokjs/core/engine";
import {
  createNativeChannel as sdkCreateNativeChannel,
  type AuthSessionOpener as AuthSessionOpenerType,
} from "@avokjs/core/channel";

// ─── Re-exports ───────────────────────────────────────────────────────────────

// createAvokClient is the RN provider-wiring (symmetric with @avokjs/react): takes the operator's
// WalletInfo and exposes getEip1193Provider(). The browser-only announce is window-gated inside.
export { createAvokClient } from "./provider-wiring.js";

// Compute the EIP-6963 reverse-DNS wallet id from an origin (the wiring applies it automatically when
// `wallet.rdns` is omitted; exported so an operator can set it explicitly).
export { rdnsFromOrigin } from "@avokjs/core/engine";
export type { WiredAvokClient } from "./provider-wiring.js";
export type {
  StorageAdapter,
  Connection,
  Account,
  ClientConfig,
  CreateOpts,
  ContinueOpts,
  AvokClient,
  TxOpts,
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
} from "@avokjs/core/engine";

export type {
  ReactNativePasskeyLike,
  ReactNativePasskeyCreateResult,
  ReactNativePasskeyGetResult,
} from "@avokjs/core/wallet";

export { secureStoreStorage } from "./native-storage.js";
export type { SecureStoreShape } from "./native-storage.js";

export { AvokProvider } from "./provider.js";

export { useAvok, useAccount, useLogin, useLogout } from "./hooks.js";

// ─── Shared-origin (native) ───────────────────────────────────────────────────────────────────────
//
// The rail for apps that do NOT own the origin-point's rpId domain — which is the whole reason
// shared-origin exists, and it is the same constraint on native as on web: an app cannot host
// /.well-known files for someone else's domain, so the ceremony must run somewhere that genuinely IS
// that origin.
//
// It works because PRF evaluates inside an in-app browser tab — measured on real hardware; see
// VERIFICATION.md §3b. RFC 8252 §6 recommends this shape, and §8.12 forbids the WebView alternative.
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
 *   originPoint: "https://vault.example.com",
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
  originPoint: string;
  redirectUri: string;
  openAuthSession: AuthSessionOpenerType;
  storage?: StorageAdapter;
}): Connection {
  return sdkCreateSharedOrigin({
    originPoint: opts.originPoint,
    channel: sdkCreateNativeChannel({
      originPoint: opts.originPoint,
      redirectUri: opts.redirectUri,
      openAuthSession: opts.openAuthSession,
    }),
    ...(opts.storage ? { storage: opts.storage as never } : {}),
  });
}
