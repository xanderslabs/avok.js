// Public surface of @avokjs/provider — the standard dapp providers over an Avok connection.

export { createEip1193Provider } from "./eip1193.js";
export type { Eip1193Provider, Eip1193Options } from "./eip1193.js";

export { announceEip6963 } from "./eip6963.js";
export type { Eip6963ProviderInfo } from "./eip6963.js";

export { registerAvokSolanaWallet } from "./solana-standard.js";
export type { SolanaStandardOptions } from "./solana-standard.js";
