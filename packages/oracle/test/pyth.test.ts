import { describe, expect, it } from "vitest";
import { readPyth } from "../src/pyth.js";

const hermes = (price: string, expo: number, publish_time: number) => async () => ({
  ok: true, status: 200,
  json: async () => ({ parsed: [{ id: "abc", price: { price, expo, publish_time } }] }),
});

describe("readPyth", () => {
  it("normalizes {price,expo:-8} to priceE8", async () => {
    const r = await readPyth({ fetch: hermes("14250000000", -8, 1000) as never, hermesUrl: "https://h", feedId: "0xabc", maxStalenessSec: 60, now: 1000 });
    expect(r).toEqual({ priceE8: 14250000000n });
  });
  it("scales expo -6 up and expo -9 down to priceE8", async () => {
    expect((await readPyth({ fetch: hermes("142500000", -6, 1000) as never, hermesUrl: "https://h", feedId: "0xabc", maxStalenessSec: 60, now: 1000 })).priceE8).toBe(14250000000n);
    expect((await readPyth({ fetch: hermes("142500000000", -9, 1000) as never, hermesUrl: "https://h", feedId: "0xabc", maxStalenessSec: 60, now: 1000 })).priceE8).toBe(14250000000n);
  });
  it("throws on a stale price", async () => {
    await expect(readPyth({ fetch: hermes("14250000000", -8, 1000) as never, hermesUrl: "https://h", feedId: "0xabc", maxStalenessSec: 60, now: 2000 })).rejects.toThrow(/stale/i);
  });
  it("throws on a non-positive price and on a non-ok response", async () => {
    await expect(readPyth({ fetch: hermes("0", -8, 2000) as never, hermesUrl: "https://h", feedId: "0xabc", maxStalenessSec: 60, now: 2000 })).rejects.toThrow(/non-positive/i);
    await expect(readPyth({ fetch: (async () => ({ ok: false, status: 503, json: async () => ({}) })) as never, hermesUrl: "https://h", feedId: "0xabc", maxStalenessSec: 60, now: 2000 })).rejects.toThrow(/503|hermes/i);
  });
  it("throws on an out-of-range exponent", async () => {
    await expect(readPyth({ fetch: hermes("14250000000", 100, 1000) as never, hermesUrl: "https://h", feedId: "0xabc", maxStalenessSec: 60, now: 1000 })).rejects.toThrow(/exponent/i);
    await expect(readPyth({ fetch: hermes("14250000000", -19, 1000) as never, hermesUrl: "https://h", feedId: "0xabc", maxStalenessSec: 60, now: 1000 })).rejects.toThrow(/exponent/i);
  });
  it("throws when the returned id does not match the requested feed", async () => {
    const mismatch = async () => ({
      ok: true, status: 200,
      json: async () => ({ parsed: [{ id: "deadbeef", price: { price: "14250000000", expo: -8, publish_time: 1000 } }] }),
    });
    await expect(readPyth({ fetch: mismatch as never, hermesUrl: "https://h", feedId: "0xabc", maxStalenessSec: 60, now: 1000 })).rejects.toThrow(/different or unidentified/i);
  });
});
