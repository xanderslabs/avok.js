// ─── Provider ────────────────────────────────────────────────────────────────
export { AvokProvider } from "./provider.js";

// ─── Auth-popup (the wallet-sandbox popup the dev hosts at their auth origin) ──
export { AuthPopup } from "./auth-popup.js";
export type { AuthPopupConfig } from "@avokjs/core/auth-popup";

// ─── Hooks ───────────────────────────────────────────────────────────────────
export {
  useAvok,
  useSelfCustody,
  useAccount,
  useCreate,
  useLogin,
  useLogout,
} from "./hooks.js";

// ─── Shared-origin connect (the WalletConnect-style trigger) ──────────────────
export { SharedOrigin } from "./shared-origin.js";
export { useAvokConnect, operatorNameFromOrigin } from "./connect.js";

// ─── Device pairing (QR ceremony) ─────────────────────────────────────────────
export { usePairingCeremony } from "./pairing.js";
export type { PairPhase, PairingCeremony } from "./pairing.js";
export { PairDevice } from "./pair-device.js";

// ─── Vanilla conveniences (re-exported for single-import DX) ─────────────────
export {
  createAvokClient,
  createOwnOriginConnection,
  createSharedOriginConnection,
  webStorage,
} from "@avokjs/core";

// ─── Types (re-exported from @avokjs/core so the published .d.ts is self-contained) ───
export type { UseOnlyAvokClient, FullAvokClient, AvokClientFor, SelfCustodyConnection, Account, CreateOpts, ContinueOpts, TxOpts, ClientConfig, SolanaTxOpts, SolanaSimulation, FeeToken, EvmFeeToken, WalletInfo } from "@avokjs/core";

// ─── Catchable error types (re-exported as values so a react app can `instanceof`-narrow them without
//     a second import of @avokjs/core). MissingRpIdError is intentionally absent (fail-fast config error). ───
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
} from "@avokjs/core";
