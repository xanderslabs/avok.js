import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, pad, toBytes, toHex, type Address, type Hex } from "viem";
import { simulateRequest, type SignTxPayload } from "../../../src/vault/simulate/client.js";
import type { RpcClient, SimLog } from "../../../src/evm/rpc.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN_A = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN_B = "0x3333333333333333333333333333333333333333" as Address;
const SPENDER = "0x4444444444444444444444444444444444444444" as Address;
const RECIPIENT = "0x5555555555555555555555555555555555555555" as Address;

function selector(sig: string): Hex {
  return keccak256(toBytes(sig));
}
function addrTopic(addr: Address): Hex {
  return pad(addr, { size: 32 });
}
function uintData(n: bigint): Hex {
  return encodeAbiParameters([{ type: "uint256" }], [n]);
}

const TRANSFER_TOPIC0 = selector("Transfer(address,address,uint256)");
const APPROVAL_TOPIC0 = selector("Approval(address,address,uint256)");

function transferLog(token: Address, from: Address, to: Address, amount: bigint): SimLog {
  return { address: token, topics: [TRANSFER_TOPIC0, addrTopic(from), addrTopic(to)], data: uintData(amount) };
}
function approvalLog(token: Address, owner: Address, spender: Address, amount: bigint): SimLog {
  return { address: token, topics: [APPROVAL_TOPIC0, addrTopic(owner), addrTopic(spender)], data: uintData(amount) };
}

function fakeRpc(simulateCalls: RpcClient["simulateCalls"]): RpcClient {
  return {
    chainId: async () => 10,
    getCode: async () => "0x",
    getTransactionCount: async () => 0,
    simulateCalls,
    call: async () => "0x",
    estimateGas: async () => 0n,
    getGasPrice: async () => 0n,
    getBaseFeePerGas: async () => 0n,
    getMaxPriorityFeePerGas: async () => 0n,
    readContract: async () => undefined as never,
    getBalance: async () => 0n,
    sendRawTransaction: async () => "0x" as Hex,
    getTransactionReceipt: async () => null,
  };
}

const PAYLOAD: SignTxPayload = {
  chainId: 10,
  account: ACCOUNT,
  calls: [{ to: TOKEN_A, value: 0n, data: "0x" }],
};

describe("simulateRequest", () => {
  it("a plain transfer: one outgoing erc20 delta, no approvals", async () => {
    const rpc = fakeRpc(async () => [
      { status: "success", gasUsed: 21000n, returnData: "0x", logs: [transferLog(TOKEN_A, ACCOUNT, RECIPIENT, 100n)] },
    ]);

    const result = await simulateRequest(rpc, PAYLOAD);

    expect(result.status).toBe("simulated");
    expect(result.deltas).toEqual([{ kind: "erc20", token: TOKEN_A, amount: 100n, direction: "out" }]);
    expect(result.approvals).toEqual([]);
  });

  it("an approve + swap batch: the approval AND both legs of the swap (out one token, in another)", async () => {
    const rpc = fakeRpc(async () => [
      { status: "success", gasUsed: 21000n, returnData: "0x", logs: [approvalLog(TOKEN_A, ACCOUNT, SPENDER, 500n)] },
      {
        status: "success",
        gasUsed: 40000n,
        returnData: "0x",
        logs: [transferLog(TOKEN_A, ACCOUNT, SPENDER, 500n), transferLog(TOKEN_B, SPENDER, ACCOUNT, 250n)],
      },
    ]);

    const result = await simulateRequest(rpc, {
      chainId: 10,
      account: ACCOUNT,
      calls: [
        { to: TOKEN_A, value: 0n, data: "0x" },
        { to: SPENDER, value: 0n, data: "0x" },
      ],
    });

    expect(result.status).toBe("simulated");
    expect(result.approvals).toEqual([
      { token: TOKEN_A, spender: SPENDER, amount: 500n, unlimited: false, kind: "erc20", approved: true },
    ]);
    // Both legs of the swap span the batch — deltas are not scoped to a single call.
    expect(result.deltas).toContainEqual({ kind: "erc20", token: TOKEN_A, amount: 500n, direction: "out" });
    expect(result.deltas).toContainEqual({ kind: "erc20", token: TOKEN_B, amount: 250n, direction: "in" });
  });

  it("a revert: blocks the happy path and surfaces the reason", async () => {
    // Error(string) selector 0x08c379a0 + abi-encoded "insufficient balance"
    const encodedReason = encodeAbiParameters([{ type: "string" }], ["insufficient balance"]);
    const returnData = `0x08c379a0${encodedReason.slice(2)}` as Hex;
    const rpc = fakeRpc(async () => [{ status: "failure", gasUsed: 21000n, returnData }]);

    const result = await simulateRequest(rpc, PAYLOAD);

    expect(result.status).toBe("reverted");
    expect(result.revert?.reason).toBe("insufficient balance");
    expect(result.deltas).toEqual([]);
    expect(result.approvals).toEqual([]);
  });

  it("a chain with no eth_simulateV1 (Arc): falls back to unsimulated, never throws", async () => {
    const rpc = fakeRpc(async () => {
      throw new Error("Method not found: eth_simulateV1");
    });

    const result = await simulateRequest(rpc, PAYLOAD);

    expect(result.status).toBe("unsimulated");
    expect(result.deltas).toEqual([]);
    expect(result.approvals).toEqual([]);
    expect(result.revert).toBeUndefined();
  });

  it("outgoing native value is known from the calldata alone, even without any logs", async () => {
    const rpc = fakeRpc(async () => [{ status: "success", gasUsed: 21000n, returnData: "0x" }]);

    const result = await simulateRequest(rpc, {
      chainId: 10,
      account: ACCOUNT,
      calls: [{ to: RECIPIENT, value: 1_000_000_000_000_000_000n, data: "0x" }],
    });

    expect(result.deltas).toContainEqual({ kind: "native", amount: 1_000_000_000_000_000_000n, direction: "out" });
  });

  it("an unlimited approval is flagged", async () => {
    const maxUint256 = 2n ** 256n - 1n;
    const rpc = fakeRpc(async () => [
      {
        status: "success",
        gasUsed: 21000n,
        returnData: "0x",
        logs: [approvalLog(TOKEN_A, ACCOUNT, SPENDER, maxUint256)],
      },
    ]);

    const result = await simulateRequest(rpc, PAYLOAD);

    expect(result.approvals[0]?.unlimited).toBe(true);
  });

  it("an unrecognized log is skipped, not thrown on", async () => {
    const weirdLog: SimLog = { address: TOKEN_A, topics: [toHex(1, { size: 32 })], data: "0x" };
    const rpc = fakeRpc(async () => [{ status: "success", gasUsed: 21000n, returnData: "0x", logs: [weirdLog] }]);

    const result = await simulateRequest(rpc, PAYLOAD);

    expect(result.status).toBe("simulated");
    expect(result.deltas).toEqual([]);
  });
});
