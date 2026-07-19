import { expect, test } from "vitest";
import { simulateResolved, decodeCalls } from "./simulate.js";
import { getChainProfile } from "@avokjs/contracts";
import { FakeRpcClient } from "./fakes.js";
import type { ResolvedBatch } from "./types.js";

const OP = getChainProfile(10)!;
const IMPL = "0x000000000000000000000000000000000000abcd" as const;
const chain = { ...OP, canonicalImplementation: IMPL };
const FEE_TOKEN = Object.keys(OP.tokens)[0] as `0x${string}`;
const ADDR = "0x1111111111111111111111111111111111111111" as const;

function batch(over: Partial<ResolvedBatch> = {}): ResolvedBatch {
  return {
    rail: "self-pay",
    chainId: 10,
    feeCalls: [],
    userCalls: [{ to: "0x2222222222222222222222222222222222222222", value: 0n, data: "0xa9059cbb" }],
    nonce: 1n,
    deadline: 99n,
    disclosures: [],
    walletAddress: ADDR,
    ...over,
  };
}

test("delegated + simulateV1 cap → eth_simulateV1, exact confidence, surfaces disclosures", async () => {
  const rpc = new FakeRpcClient({ simResults: [{ status: "success", gasUsed: 70_000n, returnData: "0x" }] });
  const res = await simulateResolved(
    batch({ disclosures: [{ kind: "delegation", implementation: IMPL }] }),
    { rpc, chain },
  );
  expect(res.method).toBe("eth_simulateV1");
  expect(res.confidence).toBe("exact");
  expect(res.success).toBe(true);
  expect(res.disclosures.some((d) => d.kind === "delegation")).toBe(true);
});

test("undelegated (authorization present) → state-override method, exact", async () => {
  const rpc = new FakeRpcClient({ simResults: [{ status: "success", gasUsed: 120_000n, returnData: "0x" }] });
  const res = await simulateResolved(
    batch({ authorization: { chainId: 10, address: IMPL, nonce: 0 } }),
    { rpc, chain },
  );
  expect(res.method).toBe("state-override");
  expect(res.confidence).toBe("exact");
});

test("gas:false → fallback, unsupported confidence", async () => {
  const rpc = new FakeRpcClient();
  const res = await simulateResolved(batch(), { rpc, chain }, { gas: false });
  expect(res.method).toBe("fallback");
  expect(res.confidence).toBe("unsupported");
});

test("delegated chain without simulateV1 → fail loud (no low-confidence fallback)", async () => {
  const rpc = new FakeRpcClient({ callReturn: "0x", estimateGas: 60_000n });
  await expect(
    simulateResolved(batch(), { rpc, chain: { ...chain, capabilities: { ...chain.capabilities, simulateV1: false } } }),
  ).rejects.toThrow(/lacks eth_simulateV1/i);
});

test("sponsored: result.fee is the fee the batch COMMITTED TO — simulate never re-prices it", async () => {
  // THIS TEST USED TO ASSERT THE BUG. It fed a batch whose committed fee was 0 and expected simulate
  // to report a fee re-derived from the SIMULATION's own gas (70k → 161_000). That is exactly the
  // defect: the batch's `feeCalls` are priced at resolve from fullGasEstimate (which also covers the
  // 7702 authorization intrinsic and the fee transfer), so re-pricing here produced a DIFFERENT
  // number — and the app showed it while the user signed the other one. On real hardware: 0.001921
  // USDC displayed, 0.004104 moved (Arc tx 0xf3f16510…b246).
  //
  // The rule now: the fee is priced ONCE, carried on the batch, and merely surfaced here.
  const rpc = new FakeRpcClient({
    gasPrice: 1_000_000_000n,
    simResults: [{ status: "success", gasUsed: 70_000n, returnData: "0x" }], // deliberately different gas
  });
  const SIGNED = 161_000n;
  const apBatch = batch({
    rail: "sponsored",
    disclosures: [{ kind: "fee", feeToken: FEE_TOKEN, amount: SIGNED }],
    fee: { feeToken: FEE_TOKEN, amount: SIGNED, gasUnits: 111_535n, gasPrice: 1_000_000_000n },
  });
  const res = await simulateResolved(apBatch, { rpc, chain });
  expect(res.fee).toBeDefined();
  expect(res.fee!.feeToken).toBe(FEE_TOKEN);
  expect(res.fee!.amount).toBe(SIGNED); // ← what is SIGNED, not what the sim's gas implies
});

test("sponsored with no priced fee on the batch: simulate invents nothing", async () => {
  const rpc = new FakeRpcClient({ simResults: [{ status: "success", gasUsed: 70_000n, returnData: "0x" }] });
  const res = await simulateResolved(batch({ rail: "sponsored" }), {
    rpc, chain,
  });
  // No committed fee → nothing to show. Better to show nothing than a number nobody will sign.
  expect(res.fee).toBeUndefined();
});

test("self-pay: result.fee is undefined — a self-pay batch commits to no fee to surface", async () => {
  const rpc = new FakeRpcClient({ simResults: [{ status: "success", gasUsed: 70_000n, returnData: "0x" }] });
  const res = await simulateResolved(batch(), { rpc, chain });
  expect(res.fee).toBeUndefined();
});

test("chain with neither simulateV1 nor stateOverride → fail loud", async () => {
  const rpc = new FakeRpcClient({ callReturn: "0x", estimateGas: 50_000n });
  await expect(
    simulateResolved(
      batch(),
      { rpc, chain: { ...chain, capabilities: { ...chain.capabilities, simulateV1: false, stateOverride: false } } },
    ),
  ).rejects.toThrow(/lacks eth_simulateV1/i);
});

test("decodeCalls labels a known ERC-20 transfer selector", () => {
  const [d] = decodeCalls([{ to: "0x2222222222222222222222222222222222222222", value: 0n, data: "0xa9059cbb00" }]);
  expect(d.selector).toBe("0xa9059cbb");
  expect(d.label).toContain("transfer");
});
