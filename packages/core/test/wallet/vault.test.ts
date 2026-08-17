import { describe, expect, test } from "vitest";
import { bytesToHex, decodeFunctionData, getAddress, stringToBytes } from "viem";
import { ACCESS_VAULT_ABI, buildAddAccessSlotCall } from "../../src/wallet/vault.js";

const ADDR = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");
const SLOT = "0x".padEnd(66, "a") as `0x${string}`;

describe("vault call-builders", () => {
  test("addAccessSlot encodes (slotId, encryptedBlob, encryptedMeta) to the wallet, no labelHash", async () => {
    const blob = stringToBytes("{}");
    const call = buildAddAccessSlotCall({
      address: ADDR,
      slotId: SLOT,
      encryptedBlob: blob,
      encryptedMeta: new Uint8Array(0),
    });
    expect(call.to).toBe(ADDR);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: ACCESS_VAULT_ABI, data: call.data });
    expect(decoded.functionName).toBe("addAccessSlot");
    expect(decoded.args[0]).toBe(SLOT);
    expect(decoded.args[1]).toBe(bytesToHex(blob)); // the encrypted blob bytes survive encoding
    expect(decoded.args).toHaveLength(3); // no labelHash; the third arg is the access-slot metadata
  });

  test("buildAddAccessSlotCall encodes the encryptedMeta as the third argument", () => {
    const call = buildAddAccessSlotCall({
      address: ADDR,
      slotId: SLOT,
      encryptedBlob: new Uint8Array(61).fill(1),
      encryptedMeta: new Uint8Array([9, 9, 9]),
    });
    const { functionName, args } = decodeFunctionData({ abi: ACCESS_VAULT_ABI, data: call.data });
    expect(functionName).toBe("addAccessSlot");
    expect(args[2]).toBe("0x090909");
  });
});
