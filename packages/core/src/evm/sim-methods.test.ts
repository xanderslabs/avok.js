import { expect, test } from "vitest";
import { decodeFunctionData, decodeAbiParameters } from "viem";
import { executeAbi, MODE_BATCH } from "@avokjs/contracts";
import { encodeExecuteBatch, buildSelfPayCalldata, simulateV1Method, stateOverrideMethod } from "./sim-methods.js";
import type { ResolvedBatch } from "./types.js";
import { FakeRpcClient } from "./fakes.js";

const ADDR = "0x1111111111111111111111111111111111111111" as const;
const IMPL = "0x000000000000000000000000000000000000abcd" as const;
const CALLS = [{ to: "0x2222222222222222222222222222222222222222" as const, value: 0n, data: "0x" as const }];
const CALLS_PARAM = [{
  type: "tuple[]",
  components: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }],
}] as const;

test("encodeExecuteBatch produces execute(MODE_BATCH, executionData)", () => {
  const data = encodeExecuteBatch(CALLS);
  const decoded = decodeFunctionData({ abi: executeAbi, data });
  expect(decoded.functionName).toBe("execute");
  expect(decoded.args[0]).toBe(MODE_BATCH);
});

test("buildSelfPayCalldata wraps feeCalls+userCalls in execute(MODE_BATCH,…) with fee-first ordering", () => {
  const USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;
  const batch: ResolvedBatch = {
    rail: "self-pay", chainId: 10, walletAddress: ADDR,
    feeCalls: [{ to: USDC, value: 0n, data: "0xfee0" }],
    userCalls: [{ to: "0x2222222222222222222222222222222222222222", value: 0n, data: "0xa9" }],
    nonce: 5n, deadline: 99n, disclosures: [],
  };
  const decoded = decodeFunctionData({ abi: executeAbi, data: buildSelfPayCalldata(batch) });
  expect(decoded.functionName).toBe("execute");
  const [calls] = decodeAbiParameters(CALLS_PARAM, decoded.args[1] as `0x${string}`);
  expect(calls[0].to.toLowerCase()).toBe(USDC.toLowerCase()); // feeCall is first
});

test("simulateV1Method sums gas and reports success", async () => {
  const rpc = new FakeRpcClient({ simResults: [{ status: "success", gasUsed: 80_000n, returnData: "0x" }] });
  const out = await simulateV1Method(rpc, { address: ADDR, implementation: IMPL, calls: CALLS });
  expect(out.success).toBe(true);
  expect(out.gasUsed).toBe(80_000n);
});

test("stateOverrideMethod injects the impl code at the wallet address", async () => {
  const IMPL_CODE = "0xdeadbeef1234" as const;
  const rpc = new FakeRpcClient({
    code: { [IMPL.toLowerCase()]: IMPL_CODE },
    simResults: [{ status: "success", gasUsed: 90_000n, returnData: "0x" }],
  });
  await stateOverrideMethod(rpc, { address: ADDR, implementation: IMPL, calls: CALLS });
  const override = rpc.lastSimulate?.stateOverrides?.[0];
  expect(override?.address).toBe(ADDR);
  expect(override?.code).toBe(IMPL_CODE);
});


test("simulateV1Method sums gas across multiple sim results", async () => {
  const rpc = new FakeRpcClient({
    simResults: [
      { status: "success", gasUsed: 30_000n, returnData: "0x" },
      { status: "success", gasUsed: 50_000n, returnData: "0x" },
    ],
  });
  const out = await simulateV1Method(rpc, { address: ADDR, implementation: IMPL, calls: CALLS });
  expect(out.success).toBe(true);
  expect(out.gasUsed).toBe(80_000n);
});
