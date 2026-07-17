import { describe, expect, it } from "vitest";
import { createOracle } from "../src/oracle.js";

describe("createOracle resolver", () => {
  it("dispatches a chainlink feed to the evm reader", async () => {
    const updatedAt = BigInt(Math.floor(Date.now() / 1000));
    const oracle = createOracle({
      evm: {
        readContract: async <T>(args: { functionName: string }) =>
          (args.functionName === "decimals" ? 8 : [1n, 250000000000n, 0n, updatedAt, 1n]) as unknown as T,
      },
    });
    expect(await oracle.read({ provider: "chainlink", address: "0xfeed000000000000000000000000000000000000" })).toEqual({ priceE8: 250000000000n });
  });
  it("dispatches a pyth feed to the hermes reader", async () => {
    const fetch = (async () => ({ ok: true, status: 200, json: async () => ({ parsed: [{ id: "abc", price: { price: "100000000", expo: -8, publish_time: Math.floor(Date.now() / 1000) } }] }) })) as never;
    const oracle = createOracle({ fetch });
    expect((await oracle.read({ provider: "pyth", feedId: "0xabc" })).priceE8).toBe(100000000n);
  });
  it("throws when a feed's provider dependency is not wired", async () => {
    await expect(createOracle({}).read({ provider: "chainlink", address: "0xfeed000000000000000000000000000000000000" })).rejects.toThrow(/evm/i);
    await expect(createOracle({}).read({ provider: "pyth", feedId: "0xabc" })).rejects.toThrow(/fetch/i);
  });
  it("throws via assertFeedConfigured on a PENDING pyth feed", async () => {
    await expect(createOracle({ fetch: (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never }).read({ provider: "pyth", feedId: "PENDING" })).rejects.toThrow(/PENDING|configured/i);
  });
});
