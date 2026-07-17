import { describe, expect, it } from "vitest";
import { readChainlink } from "../src/chainlink.js";

const NOW = 1_000_000;
const fakeEvm = (
  answer: bigint,
  updatedAt = BigInt(NOW),
  roundId = 1n,
  answeredInRound = 1n,
  decimals = 8,
) => ({
  readContract: async <T>(args: { functionName: string }) =>
    (args.functionName === "decimals"
      ? decimals
      : [roundId, answer, 0n, updatedAt, answeredInRound]) as unknown as T,
});

describe("readChainlink", () => {
  it("returns the 8-dec answer as priceE8", async () => {
    expect(await readChainlink(fakeEvm(250000000000n), "0xfeed000000000000000000000000000000000000", { now: NOW })).toEqual({ priceE8: 250000000000n });
  });
  it("scales an 18-decimal feed answer down to priceE8", async () => {
    // $2500 at 18 decimals = 2500e18; priceE8 must be 2500e8.
    const answer18 = 2500n * 10n ** 18n;
    expect(await readChainlink(fakeEvm(answer18, BigInt(NOW), 1n, 1n, 18), "0xfeed000000000000000000000000000000000000", { now: NOW }))
      .toEqual({ priceE8: 2500n * 10n ** 8n });
  });
  it("scales a 6-decimal feed answer up to priceE8", async () => {
    const answer6 = 2500n * 10n ** 6n; // $2500 at 6 decimals
    expect(await readChainlink(fakeEvm(answer6, BigInt(NOW), 1n, 1n, 6), "0xfeed000000000000000000000000000000000000", { now: NOW }))
      .toEqual({ priceE8: 2500n * 10n ** 8n });
  });
  it("throws on a non-positive answer", async () => {
    await expect(readChainlink(fakeEvm(0n), "0xfeed000000000000000000000000000000000000", { now: NOW })).rejects.toThrow(/non-positive/i);
  });
  it("throws on a stale feed (old updatedAt)", async () => {
    const staleUpdatedAt = BigInt(NOW - 100_000);
    await expect(readChainlink(fakeEvm(250000000000n, staleUpdatedAt), "0xfeed000000000000000000000000000000000000", { now: NOW })).rejects.toThrow(/stale/i);
  });
  it("throws on an incomplete round (answeredInRound < roundId)", async () => {
    await expect(readChainlink(fakeEvm(250000000000n, BigInt(NOW), 5n, 3n), "0xfeed000000000000000000000000000000000000", { now: NOW })).rejects.toThrow(/incomplete/i);
  });
});
