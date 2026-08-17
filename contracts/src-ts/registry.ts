import type { Address } from "viem";

export type ChainKind = "evm";
/** Namespaced id: "eip155:<chainId>". */
export type ChainId = string;

/**
 * The receipts gate (PRD §2, §7): no chain is called "supported" in docs, the SDK, or the pitch
 * until the fork E2E suite (contract-architecture §5: first-transaction batch + a full recovery)
 * passes against it. "unverified" is the honest default for every chain until that run is green —
 * it is not a claim the chain doesn't work, only that nobody has proven it does yet.
 */
export type ChainTier = "supported" | "unverified";

export interface ChainCapabilities {
  /** `eth_simulateV1` available (viem `simulateCalls`). */
  simulateV1: boolean;
  /** Multicall3 deployed. */
  multicall: boolean;
  /** Gas can be paid in a non-native asset at the protocol level. */
  sameAssetGas: boolean;
  /** RPC honors state overrides (code/balance injection) in simulate/call. */
  stateOverride: boolean;
}

export interface EvmTokenProfile {
  address: Address;
  symbol: string;
  decimals: number;
}

export type TokenProfile = EvmTokenProfile;

export interface EvmChainProfile {
  kind: "evm";
  id: ChainId;
  chainId: number;
  /** Human display name for UIs (e.g. "BSC", "Robinhood"). Not an identifier — do not parse it. */
  name: string;
  /** Receipts-gated claim status — see {@link ChainTier}. */
  tier: ChainTier;
  /** 7702 delegation target. */
  canonicalImplementation: Address;
  /** Marks a non-production/testnet chain (e.g. Arc testnet). Omitted on mainnet chains. */
  isTestnet?: boolean;
  explorer: string;
  rpcDefault: string;
  capabilities: ChainCapabilities;
  /** Supported fee tokens; lookup is by `address` value, case-insensitive. */
  tokens: Record<string, EvmTokenProfile>;
}

export type ChainProfile = EvmChainProfile;

const OP_USDC: Address = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";
const OP_USDT: Address = "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58";
const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_USDT: Address = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";
const ETH_USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ETH_USDT: Address = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const ARB_USDC: Address = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ARB_USDT: Address = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
const BSC_USDC: Address = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_USDT: Address = "0x55d398326f99059fF775485246999027B3197955";
const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
// Robinhood Chain (4663): bridged stablecoin liquidity is USDG ("Global Dollar"), NOT USDC/USDT.
// Canonical USDC/USDT tokens do not exist on this chain (Blockscout returns only impostor contracts).
const RHC_USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

export const CHAIN_PROFILES: Record<ChainId, ChainProfile> = {
  "eip155:10": {
    kind: "evm",
    id: "eip155:10",
    chainId: 10,
    name: "Optimism",
    tier: "unverified",
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    explorer: "https://optimistic.etherscan.io",
    rpcDefault: "https://mainnet.optimism.io",
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {
      [OP_USDC]: { address: OP_USDC, symbol: "USDC", decimals: 6 },
      [OP_USDT]: { address: OP_USDT, symbol: "USDT", decimals: 6 },
    },
  },
  "eip155:1": {
    kind: "evm",
    id: "eip155:1",
    chainId: 1,
    name: "Ethereum",
    tier: "unverified",
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    explorer: "https://etherscan.io",
    rpcDefault: "https://ethereum-rpc.publicnode.com",
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {
      [ETH_USDC]: { address: ETH_USDC, symbol: "USDC", decimals: 6 },
      [ETH_USDT]: { address: ETH_USDT, symbol: "USDT", decimals: 6 },
    },
  },
  "eip155:42161": {
    kind: "evm",
    id: "eip155:42161",
    chainId: 42161,
    name: "Arbitrum",
    tier: "unverified",
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    explorer: "https://arbiscan.io",
    rpcDefault: "https://arb1.arbitrum.io/rpc",
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {
      [ARB_USDC]: { address: ARB_USDC, symbol: "USDC", decimals: 6 },
      [ARB_USDT]: { address: ARB_USDT, symbol: "USDT", decimals: 6 },
    },
  },
  "eip155:56": {
    kind: "evm",
    id: "eip155:56",
    chainId: 56,
    name: "BSC",
    // Additionally gated on a 7702 conformance test before any support claim (its EIP-7702
    // implementation predates the final spec by two months) — PRD §7, contract-architecture §5.
    tier: "unverified",
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    explorer: "https://bscscan.com",
    rpcDefault: "https://bsc-dataseed.bnbchain.org",
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {
      [BSC_USDC]: { address: BSC_USDC, symbol: "USDC", decimals: 18 },
      [BSC_USDT]: { address: BSC_USDT, symbol: "USDT", decimals: 18 },
    },
  },
  "eip155:8453": {
    kind: "evm",
    id: "eip155:8453",
    chainId: 8453,
    name: "Base",
    // The hero chain (PRD §7) — first in line for the fork E2E suite that flips this to
    // "supported" (contract-architecture §5). That suite is deferred beyond this plan, so this
    // stays "unverified" until it actually runs green — the receipts gate means a claim, not an
    // aspiration.
    tier: "unverified",
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    explorer: "https://basescan.org",
    rpcDefault: "https://mainnet.base.org",
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {
      [BASE_USDC]: { address: BASE_USDC, symbol: "USDC", decimals: 6 },
      [BASE_USDT]: { address: BASE_USDT, symbol: "USDT", decimals: 6 },
    },
  },
  "eip155:4663": {
    kind: "evm",
    id: "eip155:4663",
    chainId: 4663,
    name: "Robinhood",
    tier: "unverified",
    // AvokCalibur is not deployed on Robinhood Chain — PENDING fails loud
    // (txengine resolve throws on the zero delegate) until a real `forge script Deploy` here.
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    explorer: "https://robinhoodchain.blockscout.com",
    rpcDefault: "https://rpc.mainnet.chain.robinhood.com",
    // All four verified via read-only RPC: eth_simulateV1 OK, Multicall3 code present at 0xcA11…CA11,
    // eth_call state override honored; native gas is ETH (no protocol-level non-native gas → sameAssetGas false).
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    // USDG ("Global Dollar", 6-dec) is the only bridged stablecoin here. Canonical USDC/USDT TOKENS
    // do not exist on this chain, so they are deliberately absent. Do not add them.
    tokens: {
      [RHC_USDG]: { address: RHC_USDG, symbol: "USDG", decimals: 6 },
    },
  },
  "eip155:5042002": {
    kind: "evm",
    id: "eip155:5042002",
    chainId: 5042002,
    name: "Arc",
    tier: "unverified",
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    isTestnet: true,
    // Arc's native gas token IS USDC (Circle's stablechain; verified docs.arc.io), so native/USD == USDC/USD.
    // Arc gas accounting is standard 18-decimal wei (docs.arc.io evm-differences); only the ERC-20 view is 6-dec.
    explorer: "https://testnet.arcscan.app",
    rpcDefault: "https://rpc.testnet.arc.network",
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {
      [ARC_USDC]: { address: ARC_USDC, symbol: "USDC", decimals: 6 },
    },
  },
  "eip155:11155111": {
    kind: "evm",
    id: "eip155:11155111",
    chainId: 11155111,
    name: "Ethereum Sepolia",
    tier: "unverified",
    isTestnet: true,
    // ENS-enabled testnet (name resolution on Sepolia). canonicalImplementation (AvokCalibur) is
    // deploy-gated (both rails need the 7702 delegate deployed here first) — PENDING fails loud
    // until then.
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    explorer: "https://sepolia.etherscan.io",
    rpcDefault: "https://ethereum-sepolia-rpc.publicnode.com",
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {},
  },
};

export function getChainProfile(chainId: number): EvmChainProfile | undefined {
  const p = CHAIN_PROFILES[`eip155:${chainId}`];
  return p && p.kind === "evm" ? p : undefined;
}

export function getTokenProfile(chainId: number, token: Address): EvmTokenProfile | undefined {
  const profile = getChainProfile(chainId);
  if (!profile) return undefined;
  const lower = token.toLowerCase();
  for (const t of Object.values(profile.tokens)) {
    if (t.address.toLowerCase() === lower) return t;
  }
  return undefined;
}

export function getChainProfileById(id: ChainId): ChainProfile | undefined {
  return CHAIN_PROFILES[id];
}

/**
 * DEFAULT operator-config value for the anchor chain (Optimism) — NOT a resolver internal.
 * Operators name their own anchor chain at vault build time (TDD §7); `resolveAnchorChain` itself
 * hardcodes no chain id. As of this branch the vault's own build config does not yet carry an
 * `anchorChainId` field — recovery/guardian wiring (a later task) is what actually consumes it.
 */
export const DEFAULT_ANCHOR_CHAIN_ID: ChainId = "eip155:10";

/**
 * Validates and resolves the operator-configured anchor chain: the single EVM chain an
 * origin-point deployment names to host guardian state, the reverse index, and recovery execution
 * (TDD §7). Throws if the id is absent from the registry or is not an EVM chain.
 */
export function resolveAnchorChain(anchorChainId: ChainId): EvmChainProfile {
  const profile = CHAIN_PROFILES[anchorChainId];
  if (!profile) {
    throw new Error(`resolveAnchorChain: unknown chain id "${anchorChainId}" — not present in the registry`);
  }
  if (profile.kind !== "evm") {
    throw new Error(
      `resolveAnchorChain: anchor chain must be an EVM chain, got "${anchorChainId}" (kind: ${profile.kind})`,
    );
  }
  return profile;
}

/**
 * Friendly chain name → CAIP-2 ChainId alias map — the SINGLE place a human-readable
 * chain name (config/env, e.g. `VITE_ANCHOR_CHAIN=base`) is mapped to a registry ChainId.
 * Every value MUST be a key present in `CHAIN_PROFILES` (guarded by test); names are the
 * most recognizable handle for each registered chain, derived from its explorer/rpc/chainId.
 * Lookups go through `resolveChainByName` (case-insensitive, fail-loud).
 */
export const CHAIN_NAME_TO_ID: Record<string, ChainId> = {
  ethereum: "eip155:1",
  optimism: "eip155:10",
  base: "eip155:8453",
  arbitrum: "eip155:42161",
  bsc: "eip155:56",
  robinhood: "eip155:4663",
  "arc-testnet": "eip155:5042002",
  sepolia: "eip155:11155111",
};

/**
 * Resolve a friendly chain name (case-insensitive) to its CAIP-2 ChainId.
 * Throws a fail-loud, named error listing every valid name on an unknown name — an
 * operator who typos `VITE_ANCHOR_CHAIN` must see exactly what is valid.
 */
export function resolveChainByName(name: string): ChainId {
  const id = CHAIN_NAME_TO_ID[name.toLowerCase()];
  if (!id) {
    const valid = Object.keys(CHAIN_NAME_TO_ID).join(", ");
    throw new Error(`resolveChainByName: unknown chain name "${name}" — valid names are: ${valid}`);
  }
  return id;
}

/**
 * Resolve a friendly chain name to its numeric EVM chainId (for the tx layer).
 * Throws (via `resolveChainByName`) on an unknown name, and throws a named error if the
 * name resolves to a non-EVM chain, which has no numeric chainId.
 */
export function chainIdNumberByName(name: string): number {
  const id = resolveChainByName(name);
  const profile = CHAIN_PROFILES[id];
  if (!profile || profile.kind !== "evm") {
    throw new Error(`chainIdNumberByName: "${name}" (${id}) is not an EVM chain — it has no numeric chainId`);
  }
  return profile.chainId;
}

export function listChains(): ChainProfile[] {
  return Object.values(CHAIN_PROFILES);
}

export function listFeeTokens(chainId?: ChainId): { chainId: ChainId; token: TokenProfile }[] {
  const out: { chainId: ChainId; token: TokenProfile }[] = [];
  for (const chain of Object.values(CHAIN_PROFILES)) {
    if (chainId !== undefined && chain.id !== chainId) continue;
    for (const token of Object.values(chain.tokens)) out.push({ chainId: chain.id, token });
  }
  return out;
}
