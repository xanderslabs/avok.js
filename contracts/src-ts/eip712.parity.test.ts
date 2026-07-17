import { describe, expect, it } from "vitest";
import { hashTypedData } from "viem";
import { avokDomain, EXECUTE_BATCH_TYPES } from "./index.js";

const domain = avokDomain(8453, "0x00000000000000000000000000000000000000A1");
const userCalls = [{ to: "0x0000000000000000000000000000000000000003", value: 1n, data: "0xabcd" }] as const;

// Generated once from this test, then pasted into Eip712Parity.t.sol (Step 4).
const EXPECTED_EXECUTE = "0x165f68a685fac273e4fd50a93146c9546ce6c035866731864e63d37b7d93be40";

describe("EIP-712 parity", () => {
  it("ExecuteBatch digest", () => {
    const d = hashTypedData({ domain, types: EXECUTE_BATCH_TYPES, primaryType: "ExecuteBatch",
      message: { calls: userCalls, nonce: 1n, deadline: 1000000n } });
    expect(d).toBe(EXPECTED_EXECUTE);
  });
});
