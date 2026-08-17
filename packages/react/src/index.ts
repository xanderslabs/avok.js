// ─── Provider ────────────────────────────────────────────────────────────────
export { AvokProvider } from "./provider.js";

// ─── Auth-popup (the wallet-sandbox popup the dev hosts at their origin-point) ──
export { AuthPopup } from "./auth-popup.js";
export type { AuthPopupConfig } from "@avokjs/core/auth-popup";

// ─── Hooks ───────────────────────────────────────────────────────────────────
export { useAvok, useAccount, useLogin, useLogout } from "./hooks.js";

// ─── Shared-origin connect (the WalletConnect-style trigger) ──────────────────
export { SharedOrigin } from "./shared-origin.js";
export { useAvokConnect, operatorNameFromOrigin } from "./connect.js";

// ─── Vanilla conveniences (re-exported for single-import DX) ─────────────────
export { createAvok, createAvokClient, createSharedOriginConnection, webStorage, rdnsFromOrigin } from "@avokjs/core";

// ─── Types (re-exported from @avokjs/core so the published .d.ts is self-contained) ───
export type {
  AvokClient,
  Connection,
  Account,
  CreateOpts,
  ContinueOpts,
  TxOpts,
  ClientConfig,
  EvmFeeToken,
  WalletInfo,
} from "@avokjs/core";

// ─── Catchable error types (re-exported as values so a react app can `instanceof`-narrow them without
//     a second import of @avokjs/core). MissingRpIdError is intentionally absent (fail-fast config error). ───
export { UnsupportedFeeTokenError, SponsorshipUnavailableError, UserRejectedError, NoPrfError } from "@avokjs/core";
