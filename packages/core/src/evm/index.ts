// Types
export type {
  Rail,
  ExecutionContext,
  Disclosure,
  PendingAuthorization,
  ResolvedBatch,
  SimulationConfidence,
  SimMethod,
  DecodedCall,
  FeeBreakdown,
  NativeFeeEstimate,
  SimulationResult,
  ReceiptStatus,
  Receipt,
  Call,
} from "./types.js";
export { railFromContext } from "./types.js";

// RPC
export type {
  RpcClient,
  ViemLike,
  SimCall,
  StateOverride,
  SimulateArgs,
  SimCallResult,
  SimLog,
  AccessListEntry,
  ReadArgs,
} from "./rpc.js";
export { createViemRpcClient } from "./rpc.js";

// Pricing (native-gas native-cost estimate)
export { estimateNativeFee } from "./pricing.js";

// Gas model (native-gas) — only the send-time fee policy is public. The raw gas constants and the
// native-gas gas/price internals stay module-private (reached via pricing.ts / resolve.ts).
export { nativeGasFees } from "./gas-model.js";

// ERC-7677 paymaster client
export type {
  Paymaster7677,
  Paymaster7677Options,
  Paymaster7677StubParams,
  Paymaster7677DataParams,
} from "./paymaster-7677.js";
export { createPaymaster7677 } from "./paymaster-7677.js";

// ERC-4337 bundler client
export type { Bundler, BundlerOptions, AvokUserOperation } from "./bundler.js";
export { createBundler } from "./bundler.js";

// v0.8 UserOp builder (the Avok Connection signs the hash directly; bundler.ts submits the raw UserOp).
export type { BuildUserOpArgs } from "./userop.js";
export { buildUserOp, getAvokUserOpHash } from "./userop.js";

// Roster-signer signature wrapping (see roster-signature.ts's module header for exactly which
// signing paths need this and which deliberately do not yet).
export { computeSecp256k1KeyHash, wrapRosterSignature } from "./roster-signature.js";

// Device roster management (register/revoke a signer) — self-calls, submitted like any other batch.
export { buildRegisterDeviceCall, buildRevokeDeviceCall, deviceKeyHash } from "./roster-calls.js";
export { readDeviceRoster } from "./roster-reads.js";
export type { RosterEntry } from "./roster-reads.js";

// Guardian-set management (setup/propose/execute/veto) — also self-calls. Guardian APPROVAL of a
// recovery is a different actor's action; see vault/recover/ instead.
export {
  buildSetupGuardiansCall,
  buildProposeGuardianOpCall,
  buildExecuteGuardianOpCall,
  buildVetoGuardianOpCall,
} from "./guardian-calls.js";
export type { GuardianOp, GuardianOpKind } from "./guardian-calls.js";
export { readGuardianState } from "./guardian-reads.js";
export type { GuardianConfig, PendingRecovery } from "./guardian-reads.js";

// Pipeline
export { isDelegatedTo } from "./resolve.js";
export type { SimulateDeps } from "./simulate.js";
export { simulateResolved } from "./simulate.js";
export { buildNativeGasCalldata } from "./sim-methods.js";
export type { TrackDeps } from "./track.js";
export { getReceiptStatus } from "./track.js";

// Registry (re-export the canonical profile from contracts)
export type {
  ChainProfile,
  ChainCapabilities,
  TokenProfile,
  EvmChainProfile,
  EvmTokenProfile,
  ChainId,
} from "@avokjs/contracts";
export {
  CHAIN_PROFILES,
  getChainProfile,
  getTokenProfile,
  getChainProfileById,
  listChains,
  listFeeTokens,
} from "@avokjs/contracts";
