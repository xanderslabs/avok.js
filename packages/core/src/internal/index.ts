// @avokjs/core/internal — the cross-package seam the provider imports. NOT part of the
// public client surface; exposes the send engine relocated out of the (soon-deleted) client.evm namespace.
export { createSendEngine } from "./send.js";
export type { SendEngine } from "./send.js";
export { createSolanaEngine } from "./solana-send.js";
export type { SolanaEngine, SolanaCluster } from "./solana-send.js";
