// @avokjs/core — the framework-agnostic public API, over the core/src/{client,wallet,evm,
// provider,channel} folders.

export { memoryStorage } from "./storage.js";
export type { StorageAdapter } from "./storage.js";
export { randomNonceAllocator, createSequentialNonceAllocator } from "./nonce.js";
export type { NonceAllocator } from "./nonce.js";

export type { Account, CreateOpts, ContinueOpts, Connection, ClientConfig } from "./types.js";

export type { SigningChannel } from "./channel/index.js";
export type { PasskeyAdapter } from "./wallet/index.js";

export { createAvokClient } from "./client/client.js";
export type { AvokClient } from "./client/client.js";
export type { TxOpts, EvmNamespace, EvmFeeToken } from "./client/evm.js";
export { UnsupportedFeeTokenError } from "./client/fee-token-error.js";
export { SponsorshipUnavailableError } from "./client/sponsorship-error.js";

// Catchable error types — the runtime errors a consumer handles BY TYPE (matching
// UnsupportedFeeTokenError above), surfaced on the main barrel even though the low-level subpaths keep
// them off their own surface.
export { NoPrfError } from "./wallet/passkey/adapter.js";
export { UserRejectedError } from "./channel/index.js";

export { createSharedOriginConnection } from "./shared-origin/connection.js";

// Surface 1 — the standard dapp provider (EIP-1193/6963) over a connection.
export * from "./provider/index.js";

// Wallet primitives the framework facades wire into a connection (platform passkey adapters + the
// state/signer types they pass through). PasskeyAdapter is already re-exported above (from wallet),
// so it is not repeated here.
export { WebAuthnPasskeyAdapter, createReactNativePasskeyAdapter } from "./wallet/index.js";
export type {
  WalletState,
  ReactNativePasskeyLike,
  ReactNativePasskeyCreateResult,
  ReactNativePasskeyGetResult,
} from "./wallet/index.js";
