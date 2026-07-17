import type { FetchLike, UsdPrice } from "./provider.js";

interface HermesParsed { id?: string; price: { price: string; expo: number; publish_time: number }; }
interface HermesResponse { parsed?: HermesParsed[]; }

/** Latest Pyth price via Hermes → priceE8 (8 decimals). */
export async function readPyth(args: {
  fetch: FetchLike; hermesUrl: string; feedId: string; maxStalenessSec: number; now?: number;
}): Promise<UsdPrice> {
  const id = args.feedId.startsWith("0x") ? args.feedId.slice(2) : args.feedId;
  const res = await args.fetch(`${args.hermesUrl}/v2/updates/price/latest?ids[]=${id}&parsed=true`);
  if (!res.ok) throw new Error(`Hermes returned status ${res.status} for feed ${args.feedId}`);
  const body = (await res.json()) as HermesResponse;
  const entry = body.parsed?.[0];
  if (!entry || typeof entry.price?.price !== "string" || typeof entry.price?.expo !== "number" || typeof entry.price?.publish_time !== "number") {
    throw new Error(`Hermes returned a malformed price for feed ${args.feedId}`);
  }
  if (typeof entry.id !== "string" || entry.id.toLowerCase() !== id.toLowerCase()) {
    throw new Error(`Hermes returned a price for a different or unidentified feed (${String(entry.id)}) than requested (${id})`);
  }
  if (entry.price.expo > 8 || entry.price.expo < -18) {
    throw new Error(`Pyth feed ${args.feedId} returned an out-of-range exponent ${entry.price.expo}`);
  }
  const price = BigInt(entry.price.price);
  if (price <= 0n) throw new Error(`Pyth feed ${args.feedId} returned a non-positive price — refusing to price`);
  const nowSec = args.now ?? Math.floor(Date.now() / 1000);
  if (nowSec - entry.price.publish_time > args.maxStalenessSec) {
    throw new Error(`Pyth feed ${args.feedId} is stale (published ${entry.price.publish_time}, now ${nowSec})`);
  }
  const shift = entry.price.expo + 8;
  const priceE8 = shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
  return { priceE8 };
}
