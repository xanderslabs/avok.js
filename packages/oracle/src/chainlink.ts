import type { Address } from "viem";
import type { EvmFeedClient, UsdPrice } from "./provider.js";

const CHAINLINK_AGGREGATOR_ABI = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" }, { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/** On-chain Chainlink USD feed (8-decimals) → priceE8. */
export async function readChainlink(
  evm: EvmFeedClient,
  address: Address,
  opts?: { maxStalenessSec?: number; now?: number },
): Promise<UsdPrice> {
  const data = await evm.readContract<readonly [bigint, bigint, bigint, bigint, bigint]>({
    address, abi: CHAINLINK_AGGREGATOR_ABI, functionName: "latestRoundData",
  });
  const [roundId, answer, , updatedAt, answeredInRound] = data;
  if (answer <= 0n) throw new Error(`Chainlink feed ${address} returned a non-positive price — refusing to price`);
  if (answeredInRound < roundId) throw new Error(`Chainlink feed ${address} returned an incomplete round (answeredInRound ${answeredInRound} < roundId ${roundId})`);
  const maxStale = BigInt(opts?.maxStalenessSec ?? 90_000);
  const nowSec = BigInt(opts?.now ?? Math.floor(Date.now() / 1000));
  if (updatedAt === 0n || nowSec - updatedAt > maxStale) throw new Error(`Chainlink feed ${address} is stale (updatedAt ${updatedAt}, now ${nowSec})`);
  // Read the feed's own decimals and normalise to priceE8 rather than blindly assuming 8 — a
  // non-8-decimal feed would otherwise misprice by orders of magnitude. If the read is unavailable
  // or out of range, fall back to 8 (the near-universal USD-feed scale) rather than failing pricing:
  // that is exactly the prior behaviour, so this is strictly an improvement for real non-8 feeds.
  let decimals = 8;
  try {
    const d = Number(await evm.readContract<bigint | number>({ address, abi: CHAINLINK_AGGREGATOR_ABI, functionName: "decimals" }));
    if (Number.isInteger(d) && d >= 0 && d <= 36) decimals = d;
  } catch {
    // decimals() unavailable — keep the 8-decimal default.
  }
  if (decimals === 8) return { priceE8: answer };
  const priceE8 = decimals < 8 ? answer * 10n ** BigInt(8 - decimals) : answer / 10n ** BigInt(decimals - 8);
  return { priceE8 };
}
