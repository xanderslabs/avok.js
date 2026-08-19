import { getChainProfile } from "./registry.js";

/**
 * RPC endpoint resolution — the ONE place an RPC URL is decided.
 *
 * An RPC is a TRUST BOUNDARY, not just a data source: we resolve names to recipient addresses
 * through it (`vitalik.eth`, `toly.sol`). An endpoint that lies about a resolution sends the user's
 * funds to the liar. So Avok ships no third-party provider as a default and never will — the
 * integrator chooses who they trust, exactly as Jupiter/Phantom-class apps do.
 *
 * Resolution order (same shape the relayers already use: `o.rpcUrl ?? chain.defaultRpc`):
 *   1. An explicit override — the integrator's own provider URL(s), their own proxy, or an
 *      operator-hosted proxy that keeps the provider key server-side. A single string is normalized
 *      to a one-element list; the integrator opts into redundancy the same way the registry does, by
 *      naming more than one.
 *   2. The registry's `defaultRpc` list — PUBLIC endpoints, and therefore DEVELOPMENT-ONLY. Public
 *      endpoints are rate-limited, carry no SLA, and block the indexed reads a wallet needs. Treat
 *      them as a way to get started, never as something to ship.
 *
 * Overrides are per-chain, so an app can point one chain at its own node(s) and leave the rest.
 *
 * REDUNDANCY (TDD §8, amended 2026-08-19): every registry `defaultRpc` carries at least two
 * independent providers, in try-order. `evmRpcUrls` returns the WHOLE list — callers that read chain
 * state (the SDK's RPC client, the Vault's simulate/recover, `avok-vault build`'s connect-src) must
 * use it and fail over across it on a transport error, never on a valid JSON-RPC error. See
 * `packages/core/src/evm/rpc.ts`'s `makeFailoverTransport` for the actual failover client.
 */
export interface RpcOverrides {
  /** EVM RPC URL(s) by chain id. A single string is one endpoint, no failover; pass an array for
   *  redundancy across your own providers. */
  evm?: Record<number, string | string[]>;
}

function normalizeOverride(override: string | string[]): string[] {
  return Array.isArray(override) ? override : [override];
}

/** Resolve every EVM RPC URL for `chainId`, in try-order: the caller's override (if any), else the
 *  registry's `defaultRpc` list. Never empty for a chain present in the registry — `defaultRpc` is
 *  required to carry at least one entry, and every current entry carries at least two. */
export function evmRpcUrls(chainId: number, overrides?: RpcOverrides): string[] {
  const override = overrides?.evm?.[chainId];
  if (override) return normalizeOverride(override);
  const profile = getChainProfile(chainId);
  if (!profile) throw new Error(`No RPC for chain ${chainId}: not in the registry and no override given.`);
  return profile.defaultRpc;
}

/** Resolve a SINGLE EVM RPC URL for `chainId` — the first of `evmRpcUrls`'s list. Prefer
 *  `evmRpcUrls` wherever the caller can fail over; this exists for call sites that only ever want one
 *  URL (e.g. a one-off diagnostic read). */
export function evmRpcUrl(chainId: number, overrides?: RpcOverrides): string {
  return evmRpcUrls(chainId, overrides)[0]!;
}

/**
 * True when this chain is running on the registry's public default rather than a configured
 * endpoint. Lets an app warn ("you are on a public dev endpoint") instead of silently degrading —
 * the public endpoints fail in ways that look like empty balances, not like errors.
 */
export function isPublicDefaultRpc(chain: { evm: number }, overrides?: RpcOverrides): boolean {
  return !overrides?.evm?.[chain.evm];
}
