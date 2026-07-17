import type { Address, Hex, TypedDataDomain } from "viem";

/** Canonical AvokWalletImplementation version string (matches IMPLEMENTATION_VERSION). */
export const AvokWalletImplementationVersion = "AvokWalletImplementation/0.1.0";

const CALL_TUPLE = {
  name: "calls",
  type: "tuple[]",
  components: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
} as const;

/** Full ABI of the canonical AvokWalletImplementation contract. */
export const AvokWalletImplementationABI = [
  { type: "function", name: "implementationVersion", inputs: [], outputs: [{ name: "", type: "string" }], stateMutability: "pure" },
  { type: "function", name: "eip712Domain", inputs: [], outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ], stateMutability: "view" },
  { type: "function", name: "execute", inputs: [{ name: "mode", type: "bytes32" }, { name: "executionData", type: "bytes" }], outputs: [], stateMutability: "payable" },
  { type: "function", name: "supportsExecutionMode", inputs: [{ name: "mode", type: "bytes32" }], outputs: [{ name: "", type: "bool" }], stateMutability: "pure" },
  { type: "function", name: "nonceUsed", inputs: [{ name: "nonce", type: "uint256" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "nonceBitmap", inputs: [{ name: "word", type: "uint256" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "domainSeparator", inputs: [], outputs: [{ name: "", type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "hashExecuteBatch", inputs: [CALL_TUPLE, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "", type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "addAccessSlot", inputs: [{ name: "slotId", type: "bytes32" }, { name: "encryptedBlob", type: "bytes" }, { name: "encryptedMeta", type: "bytes" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "getAccessSlot", inputs: [{ name: "slotId", type: "bytes32" }], outputs: [{ name: "encryptedBlob", type: "bytes" }, { name: "active", type: "bool" }, { name: "version", type: "uint64" }, { name: "addedAt", type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "getAccessSlotMeta", inputs: [{ name: "slotId", type: "bytes32" }], outputs: [{ name: "", type: "bytes" }], stateMutability: "view" },
  { type: "function", name: "getAccessSlotIds", inputs: [], outputs: [{ name: "", type: "bytes32[]" }], stateMutability: "view" },
  { type: "function", name: "removeAccessSlot", inputs: [{ name: "slotId", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "accessSlotCount", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "accessVaultStorageRoot", inputs: [], outputs: [{ name: "", type: "bytes32" }], stateMutability: "pure" },
  { type: "event", name: "AccessSlotAdded", inputs: [{ name: "wallet", type: "address", indexed: true }, { name: "slotId", type: "bytes32", indexed: false }, { name: "blobHash", type: "bytes32", indexed: false }, { name: "version", type: "uint64", indexed: false }], anonymous: false },
  { type: "event", name: "AccessSlotRemoved", inputs: [{ name: "wallet", type: "address", indexed: true }, { name: "slotId", type: "bytes32", indexed: true }], anonymous: false },
  { type: "function", name: "isValidSignature", inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }], outputs: [{ name: "magicValue", type: "bytes4" }], stateMutability: "view" },
  { type: "function", name: "supportsInterface", inputs: [{ name: "interfaceId", type: "bytes4" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
] as const;

/** ERC-7821 mode constants. */
export const MODE_BATCH: Hex = "0x0100000000000000000000000000000000000000000000000000000000000000";
export const MODE_BATCH_OPDATA: Hex = "0x0100000000007821000100000000000000000000000000000000000000000000";

/** Sliced ABI: access-slot management (labelHash-free). */
export const accessSlotAbi = AvokWalletImplementationABI.filter(
  (f) => f.type === "function" && ["addAccessSlot", "getAccessSlot", "accessSlotCount"].includes(f.name),
) as unknown as typeof AvokWalletImplementationABI;

/** Sliced ABI: ERC-1271 verification. */
export const erc1271Abi = AvokWalletImplementationABI.filter(
  (f) => f.type === "function" && f.name === "isValidSignature",
) as unknown as typeof AvokWalletImplementationABI;

/** Sliced ABI: ERC-7821 batch execution (`execute` + `supportsExecutionMode`). */
export const executeAbi = AvokWalletImplementationABI.filter(
  (f) => f.type === "function" && ["execute", "supportsExecutionMode"].includes(f.name),
) as unknown as typeof AvokWalletImplementationABI;

/** EIP-712 domain for an Avok wallet. */
export function avokDomain(chainId: number, verifyingContract: Address): TypedDataDomain {
  return { name: "AvokWallet", version: "1", chainId, verifyingContract };
}

/** EIP-712 types for the self-pay signed batch. */
export const EXECUTE_BATCH_TYPES = {
  Call: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
  ExecuteBatch: [
    { name: "calls", type: "Call[]" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type {
  ChainKind, ChainId, ChainCapabilities,
  EvmTokenProfile, SolanaTokenProfile, TokenProfile,
  EvmChainProfile, SolanaChainProfile, ChainProfile,
  EnsDeployment,
} from "./registry.js";
export {
  TOKEN_PROGRAM, TOKEN_2022_PROGRAM,
  CHAIN_PROFILES, getChainProfile, getTokenProfile,
  getSolanaChainProfile, getSolanaTokenProfile, getChainProfileById,
  listChains, listFeeTokens,
  CHAIN_NAME_TO_ID, resolveChainByName, chainIdNumberByName,
  DEFAULT_ANCHOR_CHAIN_ID, resolveAnchorChain, getEnsDeployment,
  DEFAULT_MAX_FEE_MULTIPLE_BPS, assertFeeMarkupWithinGuardrail,
} from "./registry.js";
export type { RpcOverrides } from "./rpc.js";
export { evmRpcUrl, solanaRpcUrl, isPublicDefaultRpc } from "./rpc.js";
