export type FeatureId =
  | "create"
  | "continue"
  | "import"
  | "export"
  | "accessSlot"
  | "evm-send-selfpay"
  | "evm-send-sponsored"
  | "solana-send-selfpay"
  | "solana-send-sponsored"
  | "sign"
  | "subname-resolve"
  | "add-passkey"
  | "pairing"
  | "access-roster"
  | "shared-origin-connect";

/**
 * Features this shared-origin (use-only) app covers. The wallet's keys live at the
 * operator origin, so there is NO create/export/add-passkey/pairing here —
 * those are own-origin/operator actions. Names are resolve-only. Delete this
 * file when cloning to production.
 */
export const FEATURES: FeatureId[] = [
  "shared-origin-connect",
  "evm-send-selfpay",
  "evm-send-sponsored",
  "solana-send-selfpay",
  "solana-send-sponsored",
  "sign",
  "subname-resolve",
];
