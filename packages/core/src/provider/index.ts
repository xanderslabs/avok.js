// Public surface of @avokjs/core/provider — the standard dapp providers over an Avok connection.

export { createEip1193Provider } from "./eip1193.js";
export type { Eip1193Provider, Eip1193Options } from "./eip1193.js";

export { announceEip6963 } from "./eip6963.js";
export type { Eip6963ProviderInfo } from "./eip6963.js";

export { registerAvokSolanaWallet } from "./solana-standard.js";
export type { SolanaStandardOptions } from "./solana-standard.js";

// The operator's wallet identity (name/icon/rdns) both wirings announce. Lives here — not in web/ —
// so the RN facade can share it via @avokjs/core/engine.
export type { WalletInfo } from "./wallet-info.js";
