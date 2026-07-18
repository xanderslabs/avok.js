export const VERSION = "0.0.1";

// #8: this package no longer ships a server. It is the static, clone-and-own auth-origin POPUP
// TEMPLATE (VISION §7) — an operator bakes their config in, builds, and hosts the output on any
// static host. createOrigin, the OIDC surface, the signing keys and the stores are all gone.
export type { OriginConfig } from "./config.js";
export { MissingRpIdError, assertRpId } from "./config.js";
export { resolveAppConfig } from "./app/branding.js";
export type { AppConfig } from "./app/branding.js";
export { materializeWalletState } from "./sign/wallet-state.js";

// The ceremony surface the hosted popup page mounts (see core/auth-popup/app + the emitter). Exposed
// so the page — and a future mountAuthPopup / <AuthPopup> — drive the SAME decode+sign the tests pin.
export { performSign } from "./sign/perform-sign.js";
export { decodeSignConsent, type SignConsentRequest } from "./sign/consent.js";
export { formatConsentDisplay } from "./sign/consent-display.js";

// The mountable: the wallet-sandbox popup as a plain-JS component the dev drops into their hosted auth
// page. `runAuthPopup` + `authPopupDeps` are the framework-free driver the React <AuthPopup> reuses.
export { mountAuthPopup, authPopupDeps } from "./mount.js";
export { runAuthPopup } from "./ceremony.js";
export type {
  AuthPopupConfig,
  AuthPopupView,
  AuthPopupAccount,
  AuthPopupCeremonyDeps,
} from "./ceremony.js";
