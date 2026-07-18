// @avokjs/core — the framework-agnostic public API. Consolidated from the former sdk-core / wallet-core
// / evm-txengine / solana-txengine / provider / shared-origin packages (now core/src/{client,wallet,
// evm,solana,provider,channel} folders).

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

// Surface 1 — the standard dapp providers (EIP-1193/6963 + Solana Wallet Standard) over a connection.
export * from "./provider/index.js";

// Wallet primitives the framework facades wire into a connection (platform passkey adapters + the
// state/signer types they pass through). PasskeyAdapter is already re-exported above via
// platform-adapter, so it is not repeated here.
export { WebAuthnPasskeyAdapter, createReactNativePasskeyAdapter } from "./wallet/index.js";
export type {
  WalletState,
  SolanaSigner,
  ReactNativePasskeyLike,
  ReactNativePasskeyCreateResult,
  ReactNativePasskeyGetResult,
} from "./wallet/index.js";

// Solana off-chain message envelope — used by facades that sign Solana messages.
export { encodeOffchainMessage } from "./solana/index.js";
