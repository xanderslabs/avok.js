import type { Address } from "viem";

export type ChainKind = "evm" | "solana";
/** Namespaced id: "eip155:<chainId>" | "solana:<cluster>". */
export type ChainId = string;

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

/** Classic SPL Token program address. */
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** Token-2022 (Token Extensions) program address. */
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface SolanaTokenProfile {
  mint: string;
  symbol: string;
  decimals: number;
  /** The SPL token program that owns this mint (base58). Classic or Token-2022. */
  tokenProgram: string;
  /**
   * Bytes an ASSOCIATED TOKEN ACCOUNT for this mint occupies — the size a create-ATA allocates, and
   * therefore what its rent costs. On the self-pay rail the USER funds that rent (~0.002 SOL, some
   * 400x the base fee), so a wrong number here is a wrong number on a consent screen.
   *
   * It is per-TOKEN, not per-program: a Token-2022 account's size depends on the mint's extensions.
   * MEASURE it, never derive it — a fresh PYUSD ATA is 187 bytes, while reasoning from the TLV layout
   * (165 base + 1 account_type + ImmutableOwner + TransferFeeAmount) predicts 182. Simulate the real
   * `createAssociatedTokenIdempotent` for a brand-new owner and read the created account's `space`.
   */
  ataSize: number;
}

export type TokenProfile = EvmTokenProfile | SolanaTokenProfile;

export interface EvmChainProfile {
  kind: "evm";
  id: ChainId;
  chainId: number;
  /** Human display name for UIs (e.g. "BSC", "Robinhood"). Not an identifier — do not parse it. */
  name: string;
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

export interface SolanaChainProfile {
  kind: "solana";
  id: ChainId;
  cluster: "mainnet" | "devnet";
  explorer: string;
  rpcDefault: string;
  /** Supported fee tokens, keyed by base58 mint (exact match). */
  tokens: Record<string, SolanaTokenProfile>;
}

export type ChainProfile = EvmChainProfile | SolanaChainProfile;

// Placeholder until the mainnet-deploy gate; update per chain after `forge script Deploy`.
const PENDING: Address = "0x0000000000000000000000000000000000000000";

export interface EnsDeployment {
  registry: Address;
  reverseRegistrar: Address;
  /** ENS public resolver — read for forward `addr` resolution. */
  publicResolver: Address;
}

// ENS L1 deployments. VERIFY against ENS docs before mainnet use ([[avok-pending-mainnet-values]]).
const ENS_DEPLOYMENTS: Record<number, EnsDeployment> = {
  1: {
    registry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
    reverseRegistrar: "0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb",
    publicResolver: "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63",
  },
  11155111: {
    registry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
    reverseRegistrar: "0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6",
    publicResolver: "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD",
  },
};

/** ENS contract deployment for a name-resolution chain. Throws on a chain with no known ENS deployment. */
export function getEnsDeployment(chainId: number): EnsDeployment {
  const d = ENS_DEPLOYMENTS[chainId];
  if (!d) throw new Error(`no ENS deployment for chainId ${chainId} — ENS resolution requires an ENS-enabled chain (1 or 11155111)`);
  return d;
}

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
const SOL_USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_USDT_MAINNET = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
// Circle devnet USDC; confirm before any devnet use.
const SOL_USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL_PYUSD_DEVNET = "CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM";

export const CHAIN_PROFILES: Record<ChainId, ChainProfile> = {
  "eip155:10": {
    kind: "evm",
    id: "eip155:10",
    chainId: 10,
    name: "Optimism",
    canonicalImplementation: "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C",
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
    canonicalImplementation: "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C",
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
    canonicalImplementation: "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C",
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
    canonicalImplementation: "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C",
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
    canonicalImplementation: "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C",
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
    // AvokWalletImplementation is not deployed on Robinhood Chain — PENDING fails loud
    // (txengine resolve throws on the zero delegate) until a real `forge script Deploy` here.
    canonicalImplementation: "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C",
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
    canonicalImplementation: "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C",
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
    isTestnet: true,
    // ENS-enabled testnet (name resolution on Sepolia). canonicalImplementation is deploy-gated
    // (self-pay/fronted needs the 7702 delegate deployed here first) — PENDING fails loud until then.
    canonicalImplementation: "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C",
    explorer: "https://sepolia.etherscan.io",
    rpcDefault: "https://ethereum-sepolia-rpc.publicnode.com",
    capabilities: { simulateV1: true, multicall: true, sameAssetGas: false, stateOverride: true },
    tokens: {},
  },
  "solana:mainnet": {
    kind: "solana",
    id: "solana:mainnet",
    cluster: "mainnet",
    explorer: "https://solscan.io",
    // DEV-ONLY, like every rpcDefault (see rpc.ts) — but a WORKING one: this serves browsers.
    // (Solana's own api.mainnet-beta returns 403 to any request carrying an Origin header, so it is
    // useless client-side no matter how official it is.) publicnode refuses only the indexed
    // owner-scan, which we no longer send: SPL balances derive the ATA and read it directly.
    rpcDefault: "https://solana-rpc.publicnode.com",
    tokens: {
      // Classic SPL token accounts are 165 bytes (getTokenSize(), verified at runtime).
      [SOL_USDC_MAINNET]: { mint: SOL_USDC_MAINNET, symbol: "USDC", decimals: 6, tokenProgram: TOKEN_PROGRAM, ataSize: 165 },
      [SOL_USDT_MAINNET]: { mint: SOL_USDT_MAINNET, symbol: "USDT", decimals: 6, tokenProgram: TOKEN_PROGRAM, ataSize: 165 },
    },
  },
  "solana:devnet": {
    kind: "solana",
    id: "solana:devnet",
    cluster: "devnet",
    explorer: "https://solscan.io?cluster=devnet",
    // Devnet is NOT throttled like mainnet: this actually serves getTokenAccountsByOwner from a
    // browser. (It was briefly pointed at a solana-TESTNET endpoint — a different cluster entirely,
    // where the devnet USDC mint does not exist, so balances read 0 no matter how healthy the RPC.)
    rpcDefault: "https://api.devnet.solana.com",
    tokens: {
      [SOL_USDC_DEVNET]: { mint: SOL_USDC_DEVNET, symbol: "USDC", decimals: 6, tokenProgram: TOKEN_PROGRAM, ataSize: 165 },
      // PYUSD (PayPal USD) — Token-2022, devnet sandbox mint (Paxos).
      //
      // Verified on chain (2026-07-14), because Token-2022 mints carry extensions that change how a
      // transfer behaves and none of it is inferable from the mint address:
      //   • transferFeeConfig: 0 bps, maximumFee 0  → transfers are not skimmed today. The fee
      //     AUTHORITY can raise it, and if it ever does, a sponsored fee paid in PYUSD would arrive at
      //     the fronter SHORT of the quoted amount. Acceptable on devnet; do not ship this to mainnet
      //     as a fee token without handling the transfer fee.
      //   • transferHook: programId null            → no hook program, so transferChecked behaves normally.
      //   • permanentDelegate: set (Paxos)          → the issuer can move these tokens. True of PYUSD
      //     everywhere; noted because it is a real custody property, not a quirk of devnet.
      //   • ataSize 187 bytes (rent 2,192,400 lamports) — MEASURED by simulating a create-ATA for a
      //     fresh owner, not derived. The obvious derivation gives 182 and is wrong.
      [SOL_PYUSD_DEVNET]: { mint: SOL_PYUSD_DEVNET, symbol: "PYUSD", decimals: 6, tokenProgram: TOKEN_2022_PROGRAM, ataSize: 187 },
    },
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

export function getSolanaChainProfile(cluster: "mainnet" | "devnet"): SolanaChainProfile | undefined {
  const p = CHAIN_PROFILES[`solana:${cluster}`];
  return p && p.kind === "solana" ? p : undefined;
}

export function getSolanaTokenProfile(cluster: "mainnet" | "devnet", mint: string): SolanaTokenProfile | undefined {
  const profile = getSolanaChainProfile(cluster);
  return profile ? profile.tokens[mint] : undefined;
}

export function getChainProfileById(id: ChainId): ChainProfile | undefined {
  return CHAIN_PROFILES[id];
}

/**
 * DEFAULT operator-config value for the anchor chain (Optimism) — NOT a resolver
 * internal. Operators may override this via their deployment/operator config
 * (see `auth-origin`'s `OriginConfig.anchorChainId`); `resolveAnchorChain`
 * itself hardcodes no chain id.
 */
export const DEFAULT_ANCHOR_CHAIN_ID: ChainId = "eip155:10";

/**
 * Validates and resolves the operator-configured anchor chain (the single EVM
 * chain that hosts the wallet's PRF-encrypted access-slot blob + the subname).
 * Throws if the id is absent from the registry or resolves to a Solana chain.
 */
export function resolveAnchorChain(anchorChainId: ChainId): EvmChainProfile {
  const profile = CHAIN_PROFILES[anchorChainId];
  if (!profile) {
    throw new Error(`resolveAnchorChain: unknown chain id "${anchorChainId}" — not present in the registry`);
  }
  if (profile.kind !== "evm") {
    throw new Error(`resolveAnchorChain: anchor chain must be an EVM chain, got "${anchorChainId}" (kind: ${profile.kind})`);
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
  "solana-mainnet": "solana:mainnet",
  "solana-devnet": "solana:devnet",
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
 * name resolves to a non-EVM (Solana) chain, which has no numeric chainId.
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
