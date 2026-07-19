import type { Address } from "viem";
import { listChains, getChainProfile, getSolanaChainProfile, type EvmChainProfile } from "@avokjs/contracts";
import { evmExplorerTxUrl } from "./explorers.js";

/** The two Solana clusters the wallet targets per call. Owned here so the whole helpers
 *  surface (balances, explorers, send-token lists) shares one canonical type. */
export type SolanaCluster = "devnet" | "mainnet";

const NATIVE_SYMBOL: Record<number, string> = {
  1: "ETH",
  10: "ETH",
  8453: "ETH",
  42161: "ETH",
  56: "BNB",
  5042002: "USDC",
  11155111: "ETH",
};
const ORDER = [5042002, 8453, 10, 42161, 1, 56, 11155111];

export function chainName(chainId: number): string {
  return getChainProfile(chainId)?.name ?? `Chain ${chainId}`;
}

export type SolanaSendToken = { symbol: string; mint: string | null; decimals: number };
/** Native SOL first, then the cluster's registry SPL tokens — the Solana Send token selector. */
export function solanaTokens(cluster: SolanaCluster): SolanaSendToken[] {
  const native: SolanaSendToken = { symbol: "SOL", mint: null, decimals: 9 };
  const profile = getSolanaChainProfile(cluster);
  const spl = profile
    ? Object.values(profile.tokens).map((t) => ({ symbol: t.symbol, mint: t.mint, decimals: t.decimals }))
    : [];
  return [native, ...spl];
}

export type ChainToken = { symbol: string; address: Address; decimals: number };
/** No `rpcUrl` field by design: it would hand callers the registry's PUBLIC default and quietly
 *  bypass `rpcUrls`, which is the one place an endpoint is chosen (see contracts/rpc.ts). */
export type ChainInfo = {
  id: number;
  name: string;
  nativeSymbol: string;
  /**
   * Decimals of the NATIVE GAS asset — 18 on every EVM chain, by consensus rules.
   *
   * Carried explicitly because it is a trap on Arc, whose native gas asset is USDC: gas is still
   * accounted in 18-dec wei, while Arc's ERC-20 USDC is 6-dec. A UI that formats a native gas fee
   * with the token's 6 decimals (same symbol, after all) overstates it by a factor of 10^12.
   */
  nativeDecimals: number;
  tokens: ChainToken[];
  explorerTxUrl: (hash: string) => string;
};

function toChainInfo(p: EvmChainProfile): ChainInfo {
  return {
    id: p.chainId,
    name: p.name,
    nativeSymbol: NATIVE_SYMBOL[p.chainId] ?? "ETH",
    nativeDecimals: 18,
    tokens: Object.values(p.tokens).map((t) => ({ symbol: t.symbol, address: t.address, decimals: t.decimals })),
    explorerTxUrl: (hash: string) => evmExplorerTxUrl(p.chainId, hash),
  };
}

// Include testnets (unlike the old showcase, which filtered isTestnet out).
export const evmChains: ChainInfo[] = listChains()
  .filter((c): c is EvmChainProfile => c.kind === "evm")
  .map(toChainInfo)
  .sort((a, b) => {
    const ai = ORDER.indexOf(a.id);
    const bi = ORDER.indexOf(b.id);
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
  });

export function getChain(chainId: number): ChainInfo | undefined {
  return evmChains.find((c) => c.id === chainId);
}

/**
 * Chains selectable in the chain/rail switcher. Ethereum Sepolia (11155111) is in `evmChains`
 * but its canonical wallet implementation is PENDING (see contracts/src-ts/registry.ts)
 * — it has no configured tokens as a result. A chain is "usable" here iff it carries at least one
 * configured token; an honest, self-updating predicate (no hardcoded chain id) that happens to
 * exclude Sepolia today.
 */
// Module-private: nothing outside this module consumes it (only `selectableChains` below).
function isUsableChain(chain: ChainInfo): boolean {
  return chain.tokens.length > 0;
}

export const selectableChains = evmChains.filter(isUsableChain);
