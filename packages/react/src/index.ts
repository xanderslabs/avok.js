// ─── Provider ────────────────────────────────────────────────────────────────
export { AvokProvider } from "./provider.js";

// ─── Hooks ───────────────────────────────────────────────────────────────────
export {
  useAvok,
  useSelfCustody,
  useAccount,
  useCreate,
  useLogin,
  useLogout,
} from "./hooks.js";

// ─── Vanilla conveniences (re-exported for single-import DX) ─────────────────
export {
  createAvokClient,
  createOwnOriginConnection,
  createSharedOriginConnection,
  webStorage,
} from "@avokjs/vanilla";

// ─── Types (re-exported from @avokjs/vanilla so the published .d.ts is self-contained) ───
export type { AvokClient, UseOnlyAvokClient, FullAvokClient, AvokClientFor, SelfCustodyConnection, Account, CreateOpts, ContinueOpts, TxOpts, ClientConfig, SolanaTxOpts, SolanaSimulation, FeeToken, EvmFeeToken } from "@avokjs/vanilla";
export { UnsupportedFeeTokenError } from "@avokjs/vanilla";
