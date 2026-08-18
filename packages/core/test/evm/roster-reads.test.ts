import { describe, expect, it } from "vitest";
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { readDeviceRoster } from "../../src/evm/roster-reads.js";
import { computeSecp256k1KeyHash } from "../../src/evm/roster-signature.js";
import type { RpcClient } from "../../src/evm/rpc.js";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const DEVICE_A = "0x2222222222222222222222222222222222222222" as Address;

function fakeRpc(readContract: RpcClient["readContract"]): RpcClient {
  return {
    chainId: async () => 10,
    getCode: async () => "0x",
    getTransactionCount: async () => 0,
    simulateCalls: async () => [],
    call: async () => "0x",
    estimateGas: async () => 0n,
    getGasPrice: async () => 0n,
    getBaseFeePerGas: async () => 0n,
    getMaxPriorityFeePerGas: async () => 0n,
    readContract,
    getBalance: async () => 0n,
    sendRawTransaction: async () => "0x" as Hex,
    getTransactionReceipt: async () => null,
  };
}

describe("readDeviceRoster", () => {
  it("returns an empty roster when keyCount is 0, without calling keyAt", async () => {
    let keyAtCalls = 0;
    const rpc = fakeRpc(async (args) => {
      if (args.functionName === "keyCount") return 0n as never;
      keyAtCalls++;
      throw new Error("should not call keyAt");
    });
    const roster = await readDeviceRoster(rpc, WALLET);
    expect(roster).toEqual([]);
    expect(keyAtCalls).toBe(0);
  });

  it("decodes a Secp256k1 entry's device address and computes its keyHash to match computeSecp256k1KeyHash", async () => {
    const publicKey = encodeAbiParameters([{ type: "address" }], [DEVICE_A]);
    const rpc = fakeRpc(async (args) => {
      if (args.functionName === "keyCount") return 1n as never;
      if (args.functionName === "keyAt") return [2, publicKey] as never;
      throw new Error(`unexpected: ${args.functionName}`);
    });
    const [entry] = await readDeviceRoster(rpc, WALLET);
    expect(entry.keyType).toBe(2);
    expect(entry.address?.toLowerCase()).toBe(DEVICE_A.toLowerCase());
    expect(entry.keyHash).toBe(computeSecp256k1KeyHash(DEVICE_A));
  });

  it("a non-Secp256k1 entry carries no address field", async () => {
    // A 64-byte (x,y) P256 public key — 130 hex chars + 0x = 132 chars, not the 66-char Secp256k1 shape.
    const p256PublicKey = `0x${"ab".repeat(64)}` as Hex;
    const rpc = fakeRpc(async (args) => {
      if (args.functionName === "keyCount") return 1n as never;
      if (args.functionName === "keyAt") return [0, p256PublicKey] as never;
      throw new Error(`unexpected: ${args.functionName}`);
    });
    const [entry] = await readDeviceRoster(rpc, WALLET);
    expect(entry.keyType).toBe(0);
    expect(entry.address).toBeUndefined();
  });

  it("iterates keyAt for every index up to keyCount", async () => {
    const seenIndices: bigint[] = [];
    const publicKey = encodeAbiParameters([{ type: "address" }], [DEVICE_A]);
    const rpc = fakeRpc(async (args) => {
      if (args.functionName === "keyCount") return 3n as never;
      if (args.functionName === "keyAt") {
        seenIndices.push((args.args as [bigint])[0]);
        return [2, publicKey] as never;
      }
      throw new Error(`unexpected: ${args.functionName}`);
    });
    const roster = await readDeviceRoster(rpc, WALLET);
    expect(roster).toHaveLength(3);
    expect(seenIndices).toEqual([0n, 1n, 2n]);
  });
});
