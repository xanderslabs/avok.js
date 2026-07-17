import { assertFeedConfigured, type PriceFeed } from "@avokjs/contracts";
import type { OracleDeps, PriceOracle, UsdPrice } from "./provider.js";
import { readChainlink } from "./chainlink.js";
import { readPyth } from "./pyth.js";

const DEFAULT_HERMES = "https://hermes.pyth.network";
const DEFAULT_STALENESS_SEC = 60;

/** Build a provider-agnostic oracle. Dispatches read() by feed.provider; throws if a needed dep is absent. */
export function createOracle(deps: OracleDeps): PriceOracle {
  return {
    async read(feed: PriceFeed): Promise<UsdPrice> {
      assertFeedConfigured(feed);
      switch (feed.provider) {
        case "chainlink":
          if (!deps.evm) throw new Error("Oracle: a chainlink feed was requested but no `evm` client was provided");
          return readChainlink(deps.evm, feed.address, { maxStalenessSec: deps.chainlinkMaxStalenessSec });
        case "pyth":
          if (!deps.fetch) throw new Error("Oracle: a pyth feed was requested but no `fetch` was provided");
          return readPyth({
            fetch: deps.fetch, hermesUrl: deps.hermesUrl ?? DEFAULT_HERMES,
            feedId: feed.feedId, maxStalenessSec: deps.maxStalenessSec ?? DEFAULT_STALENESS_SEC,
          });
        default: {
          const _exhaustive: never = feed;
          throw new Error(`Oracle: unsupported provider ${(_exhaustive as { provider: string }).provider}`);
        }
      }
    },
  };
}
