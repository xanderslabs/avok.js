import { describe, expect, test } from "vitest";
import { bytesToHex, decodeFunctionData, getAddress, toFunctionSelector } from "viem";
import { base58 } from "@scure/base";
import {
  createVoucherRegistrarCallBuilder,
  createOpenClaimRegistrarCallBuilder,
  buildSetPrimaryNameCall,
  buildSetSolanaAddrCall,
  SOLANA_COIN_TYPE,
} from "../src/registrar.js";

const REGISTRAR = getAddress("0x00000000000000000000000000000000000000aa");
const OWNER = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");

describe("registrar call builders", () => {
  test("voucher builder derives args from the signed voucher (NAME-1)", () => {
    const call = createVoucherRegistrarCallBuilder(REGISTRAR).buildMintCall({
      voucher: { label: "alice", owner: OWNER, expiry: 42n },
      signature: "0xdead",
    });
    expect(call.to).toBe(REGISTRAR);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "registerWithVoucher",
          stateMutability: "nonpayable",
          inputs: [
            { name: "label", type: "string" },
            { name: "owner", type: "address" },
            { name: "expiry", type: "uint64" },
            { name: "signature", type: "bytes" },
          ],
          outputs: [],
        },
      ],
      data: call.data,
    });
    expect(decoded.args).toEqual(["alice", OWNER, 42n, "0xdead"]);
  });

  test("open-claim builder encodes claim(string)", () => {
    const call = createOpenClaimRegistrarCallBuilder(REGISTRAR).buildMintCall({ label: "alice" });
    const data = call.data.toLowerCase();
    expect(data.startsWith(toFunctionSelector("claim(string)").toLowerCase())).toBe(true);
  });

  test("buildSetPrimaryNameCall targets the chain's ReverseRegistrar with setName(string)", () => {
    const call = buildSetPrimaryNameCall(1, "alice.qudiid.eth");
    expect(call.to).toBe(getAddress("0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb"));
    const data = call.data.toLowerCase();
    expect(data.startsWith(toFunctionSelector("setName(string)").toLowerCase())).toBe(true);
  });

  test("buildSetSolanaAddrCall encodes multicoin setAddr(node, 501, solanaBytes)", () => {
    const node = ("0x" + "11".repeat(32)) as `0x${string}`;
    const solanaAddress = "36Dn3RWhB8x4c83W6ebQ2C2eH9sh5bQX2nMdkP2cWaA4";
    const call = buildSetSolanaAddrCall(REGISTRAR, node, solanaAddress);
    expect(call.to).toBe(REGISTRAR);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "setAddr",
          stateMutability: "nonpayable",
          inputs: [
            { name: "node", type: "bytes32" },
            { name: "coinType", type: "uint256" },
            { name: "a", type: "bytes" },
          ],
          outputs: [],
        },
      ],
      data: call.data,
    });
    expect(decoded.args[0]).toBe(node);
    expect(decoded.args[1]).toBe(SOLANA_COIN_TYPE);
    expect(decoded.args[2]).toBe(bytesToHex(base58.decode(solanaAddress)));
  });
});
