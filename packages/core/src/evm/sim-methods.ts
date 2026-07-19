import { type Address, type Hex, encodeAbiParameters, encodeFunctionData } from "viem";
import { executeAbi, MODE_BATCH } from "@avokjs/contracts";
import type { RpcClient } from "./rpc.js";
import type { Call, ResolvedBatch } from "./types.js";

export interface SimOutcome {
  success: boolean;
  gasUsed: bigint;
  revertReason?: string;
}
export interface SimMethodArgs {
  address: Address;
  implementation: Address;
  calls: Call[];
}

const CALLS_PARAM = [
  {
    type: "tuple[]",
    components: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

/** `execute(MODE_BATCH, abi.encode(Call[]))` calldata. */
export function encodeExecuteBatch(calls: Call[]): Hex {
  const executionData = encodeAbiParameters(CALLS_PARAM, [
    calls.map((c) => ({ to: c.to, value: c.value, data: c.data })),
  ]);
  return encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [MODE_BATCH, executionData] });
}

/** self-pay: the wallet EOA's own type-4 tx calls execute(MODE_BATCH, executionData). Fee calls first. */
export function buildSelfPayCalldata(batch: ResolvedBatch): Hex {
  return encodeExecuteBatch([...batch.feeCalls, ...batch.userCalls]);
}

function summarize(results: { status: "success" | "failure"; gasUsed: bigint; error?: string }[]): SimOutcome {
  const gasUsed = results.reduce((s, r) => s + r.gasUsed, 0n);
  const failed = results.find((r) => r.status === "failure");
  return { success: !failed, gasUsed, revertReason: failed?.error };
}

/** Method 1: eth_simulateV1 of the batch as a self-call. */
export async function simulateV1Method(rpc: RpcClient, args: SimMethodArgs): Promise<SimOutcome> {
  const data = encodeExecuteBatch(args.calls);
  const results = await rpc.simulateCalls({
    account: args.address,
    calls: [{ from: args.address, to: args.address, data }],
  });
  return summarize(results);
}

/** Method 2: simulateV1 with the impl bytecode injected at the wallet → simulate an undelegated EOA as delegated. */
export async function stateOverrideMethod(rpc: RpcClient, args: SimMethodArgs): Promise<SimOutcome> {
  const data = encodeExecuteBatch(args.calls);
  const implCode = await rpc.getCode(args.implementation);
  const results = await rpc.simulateCalls({
    account: args.address,
    calls: [{ from: args.address, to: args.address, data }],
    stateOverrides: [{ address: args.address, code: implCode }],
  });
  return summarize(results);
}
