// Types
export type {
  Rail, ExecutionContext, Disclosure, PendingAuthorization, ResolvedBatch,
  SimulationConfidence, SimMethod, DecodedCall, FeeBreakdown, NativeFeeEstimate, SimulationResult,
  ReceiptStatus, Receipt, Call,
} from "./types.js";
export { railFromContext } from "./types.js";

// RPC
export type { RpcClient, ViemLike, SimCall, StateOverride, SimulateArgs, SimCallResult, ReadArgs } from "./rpc.js";
export { createViemRpcClient } from "./rpc.js";

// Pricing (self-pay native-cost estimate)
export { estimateNativeFee } from "./pricing.js";

// Gas model (self-pay)
export {
  BASE_TX_GAS, AUTH_7702_GAS,
  SELF_PAY_FEE_MUL, SELF_PAY_TIP_MUL, selfPayFees, selfPayEffectiveGasPrice, selfPayGasEstimate,
} from "./gas-model.js";

// Vault reader
export { createViemVaultReader } from "./vault-reader.js";

// Injectable fetch shape (formerly re-exported from the deleted bespoke paymaster client)
export type { FetchLike } from "./http.js";

// ERC-7677 paymaster client
export type { Paymaster7677, Paymaster7677Options, Paymaster7677StubParams, Paymaster7677DataParams } from "./paymaster-7677.js";
export { createPaymaster7677 } from "./paymaster-7677.js";

// ERC-4337 bundler client
export type { Bundler, BundlerOptions, AvokUserOperation } from "./bundler.js";
export { createBundler } from "./bundler.js";

// v0.8 UserOp builder + Connection-signed custom smart account
export type { UserOpSigner, BuildUserOpArgs, ToAvokSmartAccountArgs } from "./userop.js";
export { buildUserOp, getAvokUserOpHash, toAvokSmartAccount } from "./userop.js";

// Pipeline
export type { ResolveArgs } from "./resolve.js";
export { resolveBatch, isDelegatedTo } from "./resolve.js";
export type { SimulateDeps } from "./simulate.js";
export { simulateResolved, decodeCalls } from "./simulate.js";
export { buildSelfPayCalldata } from "./sim-methods.js";
export type { TrackDeps } from "./track.js";
export { getReceiptStatus } from "./track.js";

// Registry (re-export the canonical profile from contracts)
export type {
  ChainProfile, ChainCapabilities, TokenProfile,
  EvmChainProfile, EvmTokenProfile, SolanaChainProfile, SolanaTokenProfile,
  ChainId,
} from "@avokjs/contracts";
export {
  CHAIN_PROFILES, getChainProfile, getTokenProfile,
  getSolanaChainProfile, getSolanaTokenProfile, getChainProfileById,
  listChains, listFeeTokens,
} from "@avokjs/contracts";
