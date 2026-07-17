export const VERSION = "0.0.1";

// #8: this package no longer ships a server. It is the static, clone-and-own auth-origin POPUP
// TEMPLATE (VISION §7) — an operator bakes their config in, builds, and hosts the output on any
// static host. createOrigin, the OIDC surface, the signing keys and the stores are all gone.
export type { OriginConfig } from "./config.js";
export { MissingRpIdError, assertRpId } from "./config.js";
export { resolveAppConfig } from "./app/branding.js";
export type { AppConfig } from "./app/branding.js";
export { materializeWalletState } from "./sign/wallet-state.js";
