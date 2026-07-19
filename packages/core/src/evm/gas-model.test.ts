import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { BASE_TX_GAS, AUTH_7702_GAS, selfPayGasEstimate } from "./gas-model.js";
import type { Call } from "./types.js";
import type { RpcClient, SimCallResult } from "./rpc.js";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const SINK = "0x2222222222222222222222222222222222222222" as Address;
const IMPL = "0x3333333333333333333333333333333333333333" as Address;

// Fake RpcClient. `simulateCalls` is eth_simulateV1: its gasUsed is the FULL transaction gas of the
// call it simulates — intrinsic, calldata AND execution. (Verified on Arc: simulating
// `execute([transfer])` returns 56,090 and the real transaction used exactly 56,090.) The estimator
// used to add the intrinsic and a pile of constants ON TOP of this, over-quoting by ~44%.
const SIM_GAS = 56_090n;
function fakeRpc(overrides: Partial<RpcClient> = {}): RpcClient {
  return {
    chainId: async () => 8453,
    getCode: async () => "0x",
    getTransactionCount: async () => 0,
    simulateCalls: async ({ calls }) =>
      calls.map<SimCallResult>(() => ({ status: "success", gasUsed: SIM_GAS, returnData: "0x" })),
    call: async () => "0x",
    estimateGas: async () => 0n,
    getGasPrice: async () => 1n,
    getBaseFeePerGas: async () => 1n,
    getMaxPriorityFeePerGas: async () => 1n,
    getBalance: async () => 10n ** 18n,
    readContract: async () => undefined as never,
    sendRawTransaction: async () => "0x" as Hex,
    getTransactionReceipt: async () => null,
    ...overrides,
  };
}

const call = (): Call => ({ to: SINK, value: 0n, data: "0x" });

describe("gas constants", () => {
  it("are the calibrated positive values", () => {
    expect(BASE_TX_GAS).toBe(21_000n);
    expect(AUTH_7702_GAS).toBe(25_000n);
  });
});

describe("selfPayGasEstimate", () => {
  it("IS the simulation — self-pay sends exactly the transaction it simulates", async () => {
    // The wallet calling execute() on itself is precisely what self-pay broadcasts, so the
    // simulation's gas is the answer. Nothing to add, nothing to guess.
    const g = await selfPayGasEstimate({
      rpc: fakeRpc(), walletAddress: WALLET, implementation: IMPL, calls: [call()], undelegated: false,
    });
    expect(g).toBe(SIM_GAS);

    // The old version added the 21k intrinsic (already inside the simulation) and a 10k envelope
    // constant (also already inside it), quoting ~85k for a 56k transaction — a 51% over-quote that
    // reached a real consent screen.
    expect(g).toBeLessThan(SIM_GAS + BASE_TX_GAS);
  });

  it("adds ONLY the 7702 authorization when undelegated", async () => {
    const common = { rpc: fakeRpc(), walletAddress: WALLET, implementation: IMPL, calls: [call()] };
    const d = await selfPayGasEstimate({ ...common, undelegated: false });
    const u = await selfPayGasEstimate({ ...common, undelegated: true });
    expect(u - d).toBe(AUTH_7702_GAS);
  });
});
