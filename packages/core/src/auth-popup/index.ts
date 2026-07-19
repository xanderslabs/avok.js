// #8: this package no longer ships a server. It is the static, clone-and-own auth-origin POPUP
// TEMPLATE (VISION §7) — an operator bakes their config in, builds, and hosts the output on any
// static host. createOrigin, the OIDC surface, the signing keys and the stores are all gone.
export type { OriginConfig } from "./config.js";
export { MissingRpIdError } from "./config.js";
export { resolveAppConfig } from "./app/branding.js";

// The mountable: the wallet-sandbox popup as a plain-JS component the dev drops into their hosted auth
// page. `runAuthPopup` + `authPopupDeps` are the framework-free driver the React <AuthPopup> reuses; the
// decode / sign / materialize internals stay module-private (the driver wires them, and a custom view
// receives the already-formatted consent lines via `AuthPopupView.showConsent`).
export { mountAuthPopup, authPopupDeps } from "./mount.js";
export { runAuthPopup } from "./ceremony.js";
export type { SignConsentRequest } from "./sign/consent.js";
export type {
  AuthPopupConfig,
  AuthPopupView,
  AuthPopupAccount,
  AuthPopupCeremonyDeps,
} from "./ceremony.js";
