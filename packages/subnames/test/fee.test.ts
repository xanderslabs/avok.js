import { describe, expect, test } from "vitest";
import { decodeFunctionData, getAddress } from "viem";
import { readMintFee, buildApproveFeeCall } from "../src/fee.js";

const REGISTRAR = getAddress("0x00000000000000000000000000000000000000aa");
const TOKEN = getAddress("0x00000000000000000000000000000000000000bb");
const TREASURY = getAddress("0x00000000000000000000000000000000000000cc");

describe("ENS mint fee helpers", () => {
  test("readMintFee decodes the registrar's mintFee() view", async () => {
    const client = { readContract: async () => [TOKEN, 100_000000n, TREASURY] as const };
    const fee = await readMintFee({ client, registrar: REGISTRAR });
    expect(fee).toEqual({ token: TOKEN, price: 100_000000n, treasury: TREASURY });
  });

  test("buildApproveFeeCall encodes approve(registrar, price)", () => {
    const call = buildApproveFeeCall(TOKEN, REGISTRAR, 100_000000n);
    expect(call.to).toBe(TOKEN);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({
      abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
      data: call.data,
    });
    expect(decoded.args).toEqual([REGISTRAR, 100_000000n]);
  });
});
