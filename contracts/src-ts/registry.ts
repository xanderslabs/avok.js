import type { Address } from "viem";

export type ChainKind = "evm";
/** Namespaced id: "eip155:<chainId>". */
export type ChainId = string;

/**
 * The receipts gate (PRD §2, §7), amended 2026-08-19: no chain is called "supported" or "live" in
 * docs, the SDK, or the pitch on trust alone. Two ways to earn a non-"unverified" tier:
 *
 * - `"supported (E2E)"`: the full fork/live E2E suite (contract-architecture §5: first-transaction
 *   batch, batched-send simulation, a full recovery, sponsored send where reachable) passed against
 *   this chain. Base Sepolia only, in v1 — the one chain that gets the complete run.
 * - `"live (smoke-verified)"`: a cheap smoke run passed — CREATE2 deploy, one real 7702 authorization,
 *   one batched send, one guardian setup — for a mainnet the full suite does not re-run against
 *   (deployment targets: Ethereum, Base, Arbitrum, Robinhood Chain mainnets).
 *
 * `"unverified"` is the honest default for every chain until one of those runs is green — it is not
 * a claim the chain doesn't work, only that nobody has proven it does yet. Never flip a chain's tier
 * for a run that did not actually happen against it.
 */
export type ChainTier = "unverified" | "supported (E2E)" | "live (smoke-verified)";

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
  /**
   * Independent RPC providers, in try-order — at least 2 (TDD §8, amended 2026-08-19: RPC redundancy
   * is mandatory). Finding that forced this: `sepolia.base.org`, a single pinned default, answered
   * "no backend is currently healthy" for every call during verification while publicnode/drpc/tenderly
   * served the same queries fine — one pinned endpoint is one point of failure for consent simulation
   * and guardian reads, inside a CSP that forbids reaching anywhere else. The Vault/SDK client fails
   * over across this list on a TRANSPORT error (network/HTTP/timeout), never on a valid JSON-RPC error
   * (a revert, a bad-params response) — that answer is real and failing over to ask a different node
   * would risk a second, possibly-stale opinion overriding a correct one. See `evm/rpc.ts`.
   */
  defaultRpc: string[];
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
// Circle-native testnet USDC on Base Sepolia (developers.circle.com/stablecoins/usdc-contract-addresses,
// fetched 2026-08-19), 6 decimals per Circle's standard USDC convention.
const BASE_SEPOLIA_USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
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
    // Both verified live 2026-08-19 (cast chain-id).
    defaultRpc: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"],
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
    // Both verified live 2026-08-19 (cast chain-id).
    defaultRpc: ["https://ethereum-rpc.publicnode.com", "https://ethereum.drpc.org"],
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
    // Both verified live 2026-08-19 (cast chain-id).
    defaultRpc: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
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
    // Both verified live 2026-08-19 (cast chain-id).
    defaultRpc: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"],
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
    // Both verified live 2026-08-19 (cast chain-id).
    defaultRpc: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
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
    // Deployment target (2026-08-19 amendment): a mainnet smoke run (CREATE2 deploy + one real 7702
    // auth + one batched send + one guardian setup) is what flips this to "live (smoke-verified)" —
    // stays "unverified" until that run is actually green, needs a funded key.
    tier: "unverified",
    // COMPLIANCE NOTE (2026-08-19, re-probed): Robinhood operates the sequencer for this chain WITH
    // compliance screening and a permissioned validator set — document this wherever Robinhood support
    // is claimed. Building on it is permissionless; the sequencer/validator layer is not.
    //
    // AvokCalibur is not deployed on Robinhood Chain — PENDING fails loud
    // (txengine resolve throws on the zero delegate) until a real `forge script Deploy` here.
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    explorer: "https://robinhoodchain.blockscout.com",
    // Re-probed live 2026-08-19 (cast chain-id): the pinned default, plus Tenderly's public gateway —
    // Tenderly is one of Robinhood's own documented third-party RPC providers alongside Alchemy/
    // Quicknode/Blockdaemon/dRPC (per Robinhood's public RPC-provider docs).
    defaultRpc: ["https://rpc.mainnet.chain.robinhood.com", "https://gateway.tenderly.co/public/robinhood-chain"],
    // Re-verified 2026-08-19: eth_simulateV1 OK, Multicall3 code present at 0xcA11…CA11 (both RPCs),
    // eth_call state override honored (syntactically accepted, no rejection), ArbSys.arbOSVersion()
    // reads 116 (Nitro build v3.11.3-rc.9, an Arbitrum Orbit chain) confirming the ArbOS generation
    // that carries 7702; independently corroborated by Arbitrum Foundation's own post ("ERC-4337 and
    // EIP-7702 account abstraction are live at canonical addresses on Robinhood Chain"). Native gas is
    // ETH (no protocol-level non-native gas → sameAssetGas false).
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
    // Both verified live 2026-08-19 (cast chain-id): the pinned default, plus dRPC's Arc testnet node
    // (docs.arc.io/arc/references/rpc-endpoints lists it as a third-party provider).
    defaultRpc: ["https://rpc.testnet.arc.network", "https://rpc.drpc.testnet.arc.io"],
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {
      [ARC_USDC]: { address: ARC_USDC, symbol: "USDC", decimals: 6 },
    },
  },
  "eip155:84532": {
    kind: "evm",
    id: "eip155:84532",
    chainId: 84532,
    name: "Base Sepolia",
    // The e2e-base-sepolia suite (contract-architecture §5, TDD §8) is what flips this to
    // "supported" — stays "unverified" until that run is actually green.
    tier: "unverified",
    isTestnet: true,
    canonicalImplementation: "0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e",
    explorer: "https://sepolia.basescan.org",
    // sepolia.base.org (the prior single default) is DELIBERATELY excluded: it returned "no backend is
    // currently healthy to serve traffic" for every call during 2026-08-19 verification while these two
    // served the same queries fine (both re-verified live 2026-08-19, cast chain-id). Operators may still
    // add it back via rpcOverrides, but it is not trustworthy enough to ship as a pinned default.
    defaultRpc: ["https://base-sepolia-rpc.publicnode.com", "https://gateway.tenderly.co/public/base-sepolia"],
    // Verified live 2026-08-19: chainId 84532 (cast chain-id), Multicall3 code present at
    // 0xcA11...CA11, eth_simulateV1 responds correctly. stateOverride/sameAssetGas follow the
    // OP Stack profile shared with Base mainnet (same client stack, not independently re-probed).
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {
      [BASE_SEPOLIA_USDC]: { address: BASE_SEPOLIA_USDC, symbol: "USDC", decimals: 6 },
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
    // Both verified live 2026-08-19 (cast chain-id).
    defaultRpc: ["https://ethereum-sepolia-rpc.publicnode.com", "https://gateway.tenderly.co/public/sepolia"],
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
  "base-sepolia": "eip155:84532",
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
