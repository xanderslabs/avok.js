import { describe, it, expect } from "vitest";
import { custom, numberToHex, type Address, type Hash, type Hex } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";
import { createBundler } from "../../src/evm/bundler.js";

interface RpcCall { method: string; params: readonly unknown[] }

const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const USEROP_HASH = ("0x" + "ab".repeat(32)) as Hash;
const TX_HASH = ("0x" + "cd".repeat(32)) as Hash;

const fullUserOp = {
  sender: SENDER,
  nonce: 0n,
  callData: "0xdeadbeef" as Hex,
  callGasLimit: 100_000n,
  verificationGasLimit: 100_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: 1_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  signature: "0xsig" as Hex,
};

function fakeBundlerTransport(calls: RpcCall[], opts: { receipt?: unknown } = {}) {
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const p = (params ?? []) as readonly unknown[];
      calls.push({ method, params: p });
      switch (method) {
        case "eth_estimateUserOperationGas":
          return {
            preVerificationGas: numberToHex(50_000n),
            verificationGasLimit: numberToHex(100_000n),
            callGasLimit: numberToHex(80_000n),
          };
        case "eth_sendUserOperation":
          return USEROP_HASH;
        case "eth_getUserOperationReceipt":
          return opts.receipt ?? null;
        case "eth_chainId":
          return numberToHex(84532);
        default:
          throw new Error(`unexpected method ${method}`);
      }
    },
  });
}

describe("createBundler", () => {
  it("estimateUserOperationGas returns the three gas limits as bigint and passes the v0.8 EntryPoint", async () => {
    const calls: RpcCall[] = [];
    const bundler = createBundler({ transport: fakeBundlerTransport(calls) });

    const gas = await bundler.estimateUserOperationGas(fullUserOp);

    expect(gas.preVerificationGas).toBe(50_000n);
    expect(gas.verificationGasLimit).toBe(100_000n);
    expect(gas.callGasLimit).toBe(80_000n);
    const call = calls.find((c) => c.method === "eth_estimateUserOperationGas")!;
    expect(call.params[1]).toBe(entryPoint08Address);
  });

  it("sendUserOperation returns the userOpHash", async () => {
    const calls: RpcCall[] = [];
    const bundler = createBundler({ transport: fakeBundlerTransport(calls) });

    const hash = await bundler.sendUserOperation(fullUserOp);

    expect(hash).toBe(USEROP_HASH);
    const call = calls.find((c) => c.method === "eth_sendUserOperation")!;
    expect(call.params[1]).toBe(entryPoint08Address);
  });

  it("getUserOperationReceipt returns null while pending", async () => {
    const calls: RpcCall[] = [];
    const bundler = createBundler({ transport: fakeBundlerTransport(calls) });

    const receipt = await bundler.getUserOperationReceipt(USEROP_HASH);

    expect(receipt).toBeNull();
  });

  it("getUserOperationReceipt returns { success, receipt } once mined", async () => {
    const calls: RpcCall[] = [];
    const mined = {
      userOpHash: USEROP_HASH,
      sender: SENDER,
      nonce: numberToHex(0n),
      actualGasCost: numberToHex(1000n),
      actualGasUsed: numberToHex(500n),
      success: true,
      logs: [],
      receipt: {
        transactionHash: TX_HASH,
        blockNumber: numberToHex(1n),
        blockHash: ("0x" + "ef".repeat(32)) as Hash,
        transactionIndex: numberToHex(0n),
        gasUsed: numberToHex(500n),
        cumulativeGasUsed: numberToHex(500n),
        status: "0x1",
        logs: [],
        logsBloom: ("0x" + "00".repeat(256)) as Hex,
        from: SENDER,
        to: SENDER,
        contractAddress: null,
        effectiveGasPrice: numberToHex(1n),
        type: "0x2",
      },
    };
    const bundler = createBundler({ transport: fakeBundlerTransport(calls, { receipt: mined }) });

    const receipt = await bundler.getUserOperationReceipt(USEROP_HASH);

    expect(receipt).not.toBeNull();
    expect(receipt!.success).toBe(true);
    expect(receipt!.receipt.transactionHash).toBe(TX_HASH);
  });
});
