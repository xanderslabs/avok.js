import type { Address } from "viem";
import type { PriceFeed, OracleProvider } from "@avokjs/contracts";

export type { PriceFeed, OracleProvider };

/** USD price normalized to 8 decimals (Chainlink's native scale). */
export type UsdPrice = { priceE8: bigint };

export interface PriceOracle {
  read(feed: PriceFeed): Promise<UsdPrice>;
}

/** Minimal EVM read client (txengine's RpcClient satisfies this structurally). */
export interface EvmFeedClient {
  readContract<T>(args: { address: Address; abi: readonly unknown[]; functionName: string }): Promise<T>;
}

/** Minimal fetch shape (subset of the DOM/undici fetch). */
export type FetchLike = (url: string, init?: { method?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Open, all-optional dependency bag — extensible without breaking callers. */
export interface OracleDeps {
  evm?: EvmFeedClient;
  fetch?: FetchLike;
  hermesUrl?: string;
  /** Pyth/Hermes staleness threshold in seconds (default 60). */
  maxStalenessSec?: number;
  /** Chainlink staleness threshold in seconds (default 90_000 ≈ 25h). */
  chainlinkMaxStalenessSec?: number;
}
