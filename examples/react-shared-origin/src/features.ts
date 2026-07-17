export type FeatureId =
  | "create" | "continue" | "import" | "export" | "accessSlot"
  | "evm-send-selfpay" | "evm-send-fronted"
  | "solana-send-selfpay" | "solana-send-fronted"
  | "sign" | "subname-register" | "subname-resolve"
  | "add-passkey" | "pairing" | "access-roster" | "shared-origin-connect";

/**
 * Features this shared-origin (use-only) app covers. The wallet's keys live at the
 * operator origin, so there is NO create/export/add-passkey/pairing/
 * subname-register here — those are own-origin/operator actions. subname
 * is resolve-only. Delete this file when cloning to production.
 */
export const FEATURES: FeatureId[] = [
  "shared-origin-connect",
  "evm-send-selfpay", "evm-send-fronted",
  "solana-send-selfpay", "solana-send-fronted",
  "sign", "subname-resolve",
];
