import { describe, it, expect } from "vitest";
import { custom, numberToHex, type Address, type Hex } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";
import { createPaymaster7677 } from "../../src/evm/paymaster-7677.js";

interface RpcCall {
  method: string;
  params: readonly unknown[];
}

const PAYMASTER = "0x00000000000000000000000000000000000000Pm".replace("Pm", "01") as Address;

function fakePaymasterTransport(calls: RpcCall[]) {
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const p = (params ?? []) as readonly unknown[];
      calls.push({ method, params: p });
      if (method === "pm_getPaymasterStubData") {
        return {
          paymaster: PAYMASTER,
          paymasterData: "0xstub" as Hex,
          paymasterVerificationGasLimit: numberToHex(120_000n),
          paymasterPostOpGasLimit: numberToHex(30_000n),
        };
      }
      if (method === "pm_getPaymasterData") {
        return { paymaster: PAYMASTER, paymasterData: "0xfinal" as Hex };
      }
      throw new Error(`unexpected method ${method}`);
    },
  });
}

const baseUserOp = {
  sender: "0x1111111111111111111111111111111111111111" as Address,
  nonce: 0n,
  callData: "0xdeadbeef" as Hex,
};

describe("createPaymaster7677", () => {
  it("getPaymasterStubData returns paymaster + data + both gas limits (as bigint)", async () => {
    const calls: RpcCall[] = [];
    const pm = createPaymaster7677({ transport: fakePaymasterTransport(calls) });

    const stub = await pm.getPaymasterStubData({ ...baseUserOp, chainId: 84532 });

    expect(stub.paymaster).toBe(PAYMASTER);
    expect(stub.paymasterData).toBe("0xstub");
    expect(stub.paymasterVerificationGasLimit).toBe(120_000n);
    expect(stub.paymasterPostOpGasLimit).toBe(30_000n);
  });

  it("getPaymasterData returns the final paymaster + data", async () => {
    const calls: RpcCall[] = [];
    const pm = createPaymaster7677({ transport: fakePaymasterTransport(calls) });

    const data = await pm.getPaymasterData({ ...baseUserOp, chainId: 84532 });

    expect(data.paymaster).toBe(PAYMASTER);
    expect(data.paymasterData).toBe("0xfinal");
  });

  it("defaults to the v0.8 EntryPoint and forwards the fee-token context to the RPC params", async () => {
    const calls: RpcCall[] = [];
    const pm = createPaymaster7677({ transport: fakePaymasterTransport(calls) });
    const context = { token: "0xUSDCUSDCUSDCUSDCUSDCUSDCUSDCUSDCUSDCUSDC" };

    await pm.getPaymasterStubData({ ...baseUserOp, chainId: 84532, context });

    const call = calls.find((c) => c.method === "pm_getPaymasterStubData")!;
    // params = [userOp, entryPointAddress, chainIdHex, context] per ERC-7677.
    expect(call.params[1]).toBe(entryPoint08Address);
    expect(call.params[2]).toBe(numberToHex(84532));
    expect(call.params[3]).toEqual(context);
  });

  it("an explicit entryPointAddress overrides the v0.8 default", async () => {
    const calls: RpcCall[] = [];
    const pm = createPaymaster7677({ transport: fakePaymasterTransport(calls) });
    const custom07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address;

    await pm.getPaymasterData({ ...baseUserOp, chainId: 1, entryPointAddress: custom07 });

    const call = calls.find((c) => c.method === "pm_getPaymasterData")!;
    expect(call.params[1]).toBe(custom07);
  });
});
