import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { discoverBalanceSlot } from "../../../src/vault/simulate/slots.js";
import type { RpcClient } from "../../../src/evm/rpc.js";

const TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const USER = "0x1111111111111111111111111111111111111111" as Address;
const SLOT = "0x00000000000000000000000000000000000000000000000000000000000005" as Hex;

function baseRpc(): RpcClient {
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
    readContract: async () => undefined as never,
    getBalance: async () => 0n,
    sendRawTransaction: async () => "0x" as Hex,
    getTransactionReceipt: async () => null,
  };
}

describe("discoverBalanceSlot", () => {
  it("returns the first storage key the access list names for the token", async () => {
    const rpc: RpcClient = {
      ...baseRpc(),
      createAccessList: async (args) => {
        expect(args.to).toBe(TOKEN);
        return { accessList: [{ address: TOKEN, storageKeys: [SLOT] }] };
      },
    };
    await expect(discoverBalanceSlot(rpc, TOKEN, USER)).resolves.toBe(SLOT);
  });

  it("returns null when the RPC has no createAccessList", async () => {
    await expect(discoverBalanceSlot(baseRpc(), TOKEN, USER)).resolves.toBeNull();
  });

  it("returns null when the call fails", async () => {
    const rpc: RpcClient = {
      ...baseRpc(),
      createAccessList: async () => {
        throw new Error("not supported");
      },
    };
    await expect(discoverBalanceSlot(rpc, TOKEN, USER)).resolves.toBeNull();
  });

  it("returns null when the access list names no entry for the token", async () => {
    const rpc: RpcClient = {
      ...baseRpc(),
      createAccessList: async () => ({ accessList: [] }),
    };
    await expect(discoverBalanceSlot(rpc, TOKEN, USER)).resolves.toBeNull();
  });
});
