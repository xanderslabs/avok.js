import { expect, test } from "vitest";
import { decodeFunctionData, decodeAbiParameters } from "viem";
import { executeAbi } from "@avokjs/contracts";
import { buildSelfPayCalldata } from "../src/send-builders.js";
import type { ResolvedBatch } from "../src/types.js";

const CALLS_PARAM = [{
  type: "tuple[]",
  components: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }],
}] as const;

const ADDR = "0x1111111111111111111111111111111111111111" as const;
const USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;
function selfPayBatch(): ResolvedBatch {
  return {
    rail: "self-pay", chainId: 10, walletAddress: ADDR,
    feeCalls: [{ to: USDC, value: 0n, data: "0xfee0" }],
    userCalls: [{ to: "0x2222222222222222222222222222222222222222", value: 0n, data: "0xa9" }],
    nonce: 5n, deadline: 99n, disclosures: [],
  };
}

test("buildSelfPayCalldata wraps feeCalls+userCalls in execute(MODE_BATCH,…) with fee-first ordering", () => {
  const b = selfPayBatch(); // has feeCall to USDC and userCall to 0x2222...
  const data = buildSelfPayCalldata(b);
  const decoded = decodeFunctionData({ abi: executeAbi, data });
  expect(decoded.functionName).toBe("execute");
  const [calls] = decodeAbiParameters(CALLS_PARAM, decoded.args[1] as `0x${string}`);
  expect(calls[0].to.toLowerCase()).toBe(USDC.toLowerCase()); // feeCall is first
});
