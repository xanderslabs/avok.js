// The static, clone-and-own auth-popup TEMPLATE (VISION §7) — an operator bakes their config in,
// builds, and hosts the output on any static host. No server anywhere in the path.
export type { OriginConfig } from "./config.js";
export { MissingRpIdError } from "./config.js";
export { resolveAppConfig } from "./app/branding.js";

// The mountable: the wallet-sandbox popup as a plain-JS component the dev drops into their hosted auth
// page. `runAuthPopup` / `runAuthRedirect` + `authPopupDeps` are the framework-free drivers the React
// <AuthPopup> reuses; the
// decode / sign / materialize internals stay module-private (the driver wires them, and a custom view
// receives the already-formatted consent lines via `AuthPopupView.showConsent`).
export { mountAuthPopup, authPopupDeps } from "./mount.js";
// Two transports, ONE ceremony: the popup speaks postMessage, the redirect speaks URLs, and both
// funnel through the same consent/gesture/proof path inside.
export { runAuthPopup, runAuthRedirect } from "./ceremony.js";
export type { SignConsentRequest } from "./sign/consent.js";
// The consent screen's line shape and its severity helpers: a custom view renders these.
export type { ConsentDisplayLine } from "./sign/consent-display.js";
export { formatConsentDisplay, highestSeverity, displayText } from "./sign/consent-display.js";
export type {
  AuthPopupConfig,
  AuthPopupView,
  AuthPopupAccount,
  AuthPopupCeremonyDeps,
} from "./ceremony.js";
