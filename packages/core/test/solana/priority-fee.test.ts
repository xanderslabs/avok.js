import { describe, it, expect } from "vitest";
import { selectPriorityFee, DEFAULT_PRIORITY_FEE_PERCENTILE } from "../../src/solana/priority-fee.js";

/**
 * THE PRIORITY FEE IS A POLICY, AND THE USER PAYS FOR IT.
 *
 * `getRecentPrioritizationFees` is raw data over ~150 slots. The shipped policy took the MAX of it —
 * an upper bound, not a typical value — so ONE congested slot in the window set the bid for everyone
 * who sent afterwards. Same shape as the EVM rail's tip bug: an aggressive number nobody asked for,
 * charged to the user.
 *
 * The policy lived inline in the RPC adapter as a `reduce`, where no test could reach it. That is the
 * actual defect: a fee policy nobody can write a test against is a fee policy nobody is checking.
 */

/** A realistic window: mostly quiet, with one whale slot. This is the case that decides everything. */
const WINDOW = [0n, 0n, 0n, 0n, 100n, 200n, 500n, 1_000n, 2_000n, 5_000_000n];

describe("selecting a priority fee from the recent window", () => {
  it("does NOT bid the max — one congested slot must not set everyone's price", () => {
    const fee = selectPriorityFee(WINDOW);
    // The whale slot is 5,000,000 micro-lamports/CU. The old policy bid exactly that, on every send,
    // for as long as that slot stayed in the ~150-slot window.
    expect(fee).toBeLessThan(5_000_000n);
    expect(fee).toBe(1_000n); // nearest-rank p75 of these 10 observations is the 8th
  });

  it("defaults to the 75th percentile", () => {
    expect(DEFAULT_PRIORITY_FEE_PERCENTILE).toBe(75);
    expect(selectPriorityFee(WINDOW)).toBe(selectPriorityFee(WINDOW, { percentile: 75 }));
  });

  it("bids ZERO on a quiet network — because the correct fee there really is zero", () => {
    // Measured on mainnet 2026-07-14: every one of the 150 recent slots reported 0. A non-zero default
    // would charge every user for a congestion event that is not happening.
    expect(selectPriorityFee([0n, 0n, 0n, 0n, 0n])).toBe(0n);
  });

  it("respects a floor when the operator sets one — for a spike the window cannot see yet", () => {
    expect(selectPriorityFee([0n, 0n, 0n], { floorMicroLamports: 1_000n })).toBe(1_000n);
    // The floor is a MINIMUM, not an override: a busier window still wins.
    expect(selectPriorityFee(WINDOW, { floorMicroLamports: 500n })).toBe(1_000n);
  });

  it("no data is not evidence of congestion", () => {
    expect(selectPriorityFee([])).toBe(0n);
    expect(selectPriorityFee([], { floorMicroLamports: 50n })).toBe(50n);
  });

  it("percentile 100 still reaches the old max — reachable on request, never by default", () => {
    expect(selectPriorityFee(WINDOW, { percentile: 100 })).toBe(5_000_000n);
    expect(selectPriorityFee(WINDOW, { percentile: 100 })).not.toBe(selectPriorityFee(WINDOW));
  });

  it("percentile 0 is the minimum, and the scale is monotonic in between", () => {
    expect(selectPriorityFee(WINDOW, { percentile: 0 })).toBe(0n);
    const p50 = selectPriorityFee(WINDOW, { percentile: 50 });
    const p75 = selectPriorityFee(WINDOW, { percentile: 75 });
    const p100 = selectPriorityFee(WINDOW, { percentile: 100 });
    expect(p50).toBeLessThanOrEqual(p75);
    expect(p75).toBeLessThanOrEqual(p100);
  });

  it("does not mutate the caller's window", () => {
    const window = [5n, 1n, 3n];
    selectPriorityFee(window);
    expect(window).toEqual([5n, 1n, 3n]); // a sort in place would corrupt a caller's cached window
  });

  it("rejects a nonsense percentile rather than silently clamping it", () => {
    expect(() => selectPriorityFee(WINDOW, { percentile: 101 })).toThrow(/between 0 and 100/);
    expect(() => selectPriorityFee(WINDOW, { percentile: -1 })).toThrow(/between 0 and 100/);
  });
});
