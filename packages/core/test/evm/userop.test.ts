import { describe, it, expect } from "vitest";
import {
  decodeFunctionData,
  numberToHex,
  type Address,
  type Hex,
} from "viem";
import { getUserOperationHash, entryPoint08Address } from "viem/account-abstraction";
import { executeAbi, MODE_BATCH } from "@avokjs/contracts";
import type { Call } from "../../src/wallet/index.js";
import { buildUserOp, getAvokUserOpHash } from "../../src/evm/userop.js";

const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const IMPL = "0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C" as Address;
const CHAIN_ID = 84532;

const calls: Call[] = [
  { to: "0x2222222222222222222222222222222222222222" as Address, value: 1n, data: "0xabcd" as Hex },
];

const fees = { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };

describe("buildUserOp", () => {
  it("encodes callData as execute(MODE_BATCH, calls) and sets sender + EntryPoint nonce + fees", () => {
    const op = buildUserOp({ sender: SENDER, calls, chainId: CHAIN_ID, nonce: 7n, fees });

    expect(op.sender).toBe(SENDER);
    expect(op.nonce).toBe(7n);
    expect(op.maxFeePerGas).toBe(fees.maxFeePerGas);

    const decoded = decodeFunctionData({ abi: executeAbi, data: op.callData });
    expect(decoded.functionName).toBe("execute");
    expect(decoded.args[0]).toBe(MODE_BATCH);
  });

  it("attaches the 7702 authorization when supplied (undelegated first send)", () => {
    const authorization = {
      chainId: CHAIN_ID,
      address: IMPL,
      nonce: 3,
      r: ("0x" + "11".repeat(32)) as Hex,
      s: ("0x" + "22".repeat(32)) as Hex,
      yParity: 0 as const,
    };
    const op = buildUserOp({ sender: SENDER, calls, chainId: CHAIN_ID, nonce: 0n, fees, authorization });
    expect(op.authorization).toEqual(authorization);
  });

  it("omits the authorization when already delegated", () => {
    const op = buildUserOp({ sender: SENDER, calls, chainId: CHAIN_ID, nonce: 0n, fees });
    expect(op.authorization).toBeUndefined();
  });

  it("threads the paymaster fields when supplied", () => {
    const op = buildUserOp({
      sender: SENDER,
      calls,
      chainId: CHAIN_ID,
      nonce: 0n,
      fees,
      paymaster: { paymaster: IMPL, paymasterData: "0xbeef" as Hex, paymasterPostOpGasLimit: 30_000n },
    });
    expect(op.paymaster).toBe(IMPL);
    expect(op.paymasterData).toBe("0xbeef");
  });
});

describe("getAvokUserOpHash", () => {
  it("matches viem getUserOperationHash for EntryPoint v0.8", () => {
    const op = buildUserOp({
      sender: SENDER,
      calls,
      chainId: CHAIN_ID,
      nonce: 1n,
      fees,
      gas: { callGasLimit: 80_000n, verificationGasLimit: 100_000n, preVerificationGas: 50_000n },
    });
    const ours = getAvokUserOpHash(op, CHAIN_ID);
    const viem = getUserOperationHash({
      chainId: CHAIN_ID,
      entryPointAddress: entryPoint08Address,
      entryPointVersion: "0.8",
      userOperation: op,
    });
    expect(ours).toBe(viem);
  });
});
