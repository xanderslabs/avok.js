export const SDK_CORE_VERSION = "0.0.1";

export { memoryStorage } from "./storage.js";
export type { StorageAdapter } from "./storage.js";
export { randomNonceAllocator, createSequentialNonceAllocator } from "./nonce.js";
export type { NonceAllocator } from "./nonce.js";

export type { Account, CreateOpts, ContinueOpts, Connection, SelfCustodyConnection, ClientConfig } from "./types.js";

export type { PlatformAdapter, SigningChannel, PasskeyAdapter } from "./platform-adapter.js";

export { createAvokClient } from "./client/client.js";
export type { AvokClient, AvokClientFor, UseOnlyAvokClient, FullAvokClient } from "./client/client.js";
export type { TxOpts, EvmNamespace, EvmFeeToken } from "./client/evm.js";
export type { SolanaNamespace, SolanaTxOpts, SolanaResolved, SolanaSimulation, FeeToken } from "./client/solana.js";
export { UnsupportedFeeTokenError } from "./client/fee-token-error.js";

export { createOwnOriginConnection } from "./own-origin/connection.js";
export { createSharedOriginConnection } from "./shared-origin/connection.js";
