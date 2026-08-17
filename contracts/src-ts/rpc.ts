import { getChainProfile } from "./registry.js";

/**
 * RPC endpoint resolution — the ONE place an RPC URL is decided.
 *
 * An RPC is a TRUST BOUNDARY, not just a data source: we resolve names to recipient addresses
 * through it (`vitalik.eth`, `toly.sol`). An endpoint that lies about a resolution sends the user's
 * funds to the liar. So Avok ships no third-party provider as a default and never will — the
 * integrator chooses who they trust, exactly as Jupiter/Phantom-class apps do.
 *
 * Resolution order (same shape the relayers already use: `o.rpcUrl ?? chain.rpcDefault`):
 *   1. An explicit override — the integrator's own provider URL, their own proxy, or an
 *      operator-hosted proxy that keeps the provider key server-side.
 *   2. The registry's `rpcDefault` — a PUBLIC endpoint, and therefore DEVELOPMENT-ONLY. Public
 *      endpoints are rate-limited, carry no SLA, and block the indexed reads a wallet needs. Treat
 *      them as a way to get started, never as something to ship.
 *
 * Overrides are per-chain, so an app can point one chain at its own node and leave the rest.
 */
export interface RpcOverrides {
  /** EVM RPC URL by chain id. */
  evm?: Record<number, string>;
}

/** Resolve the EVM RPC URL for `chainId`: caller's override, else the registry's public default. */
export function evmRpcUrl(chainId: number, overrides?: RpcOverrides): string {
  const override = overrides?.evm?.[chainId];
  if (override) return override;
  const profile = getChainProfile(chainId);
  if (!profile) throw new Error(`No RPC for chain ${chainId}: not in the registry and no override given.`);
  return profile.rpcDefault;
}

/**
 * True when this chain is running on the registry's public default rather than a configured
 * endpoint. Lets an app warn ("you are on a public dev endpoint") instead of silently degrading —
 * the public endpoints fail in ways that look like empty balances, not like errors.
 */
export function isPublicDefaultRpc(chain: { evm: number }, overrides?: RpcOverrides): boolean {
  return !overrides?.evm?.[chain.evm];
}
