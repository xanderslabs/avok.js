import type { SolanaCluster } from "./chains.js";

// Per-chain block explorers (base URL, no trailing slash). Extend as needed.
const EVM_EXPLORER: Record<number, string> = {
  1: "https://etherscan.io",
  10: "https://optimistic.etherscan.io",
  56: "https://bscscan.com",
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
  42161: "https://arbiscan.io",
  5042002: "https://testnet.arcscan.app",
};

export function evmExplorerTxUrl(chainId: number, hash: string): string {
  const base = EVM_EXPLORER[chainId] ?? "https://blockscan.com";
  return `${base}/tx/${hash}`;
}

export function solanaExplorerTxUrl(cluster: SolanaCluster, signature: string): string {
  const q = cluster === "mainnet" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${q}`;
}
