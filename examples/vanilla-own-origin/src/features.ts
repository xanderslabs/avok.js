export type FeatureId =
  | "create" | "continue" | "import" | "export" | "accessSlot"
  | "evm-send-selfpay" | "evm-send-fronted"
  | "solana-send-selfpay" | "solana-send-fronted"
  | "sign" | "subname-register" | "subname-resolve"
  | "add-passkey" | "pairing" | "access-roster" | "shared-origin-connect";

/** Features this own-origin app covers. Delete this file when cloning to production. */
export const FEATURES: FeatureId[] = [
  "create", "continue", "export",
  "evm-send-selfpay", "evm-send-fronted",
  "solana-send-selfpay", "solana-send-fronted",
  "sign", "subname-register", "subname-resolve",
  "add-passkey", "pairing", "access-roster",
];
