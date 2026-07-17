import { expect, test } from "vitest";
import { hexToBytes, toHex } from "viem";
import { ContractFunctionExecutionError, ContractFunctionZeroDataError, HttpRequestError } from "viem";
import { VaultUnreadableError } from "@avokjs/wallet-core";
import { createViemVaultReader } from "../src/vault-reader.js";
import { FakeRpcClient } from "./fakes.js";

const ADDR = "0x1111111111111111111111111111111111111111" as const;
const SLOT = ("0x" + "22".repeat(32)) as `0x${string}`;

test("returns blob bytes when the slot is active", async () => {
  const blob = toHex(new Uint8Array([1, 2, 3]));
  const rpc = new FakeRpcClient({ reads: { [`${ADDR}:getAccessSlot`]: [blob, true] } });
  const reader = createViemVaultReader(rpc);
  const out = await reader.getAccessSlot(ADDR, SLOT);
  expect(out && Array.from(out)).toEqual([1, 2, 3]);
});

test("returns null when the slot is inactive", async () => {
  const rpc = new FakeRpcClient({ reads: { [`${ADDR}:getAccessSlot`]: ["0x010203", false] } });
  const reader = createViemVaultReader(rpc);
  expect(await reader.getAccessSlot(ADDR, SLOT)).toBeNull();
});

test("returns null when slot is active but blob is empty (0x)", async () => {
  const rpc = new FakeRpcClient({ reads: { [`${ADDR}:getAccessSlot`]: ["0x", true] } });
  const reader = createViemVaultReader(rpc);
  expect(await reader.getAccessSlot(ADDR, SLOT)).toBeNull();
});

test("a TRANSPORT failure throws VaultUnreadableError — it is not evidence the slot is absent", async () => {
  // This test used to assert the BUG: that getAccessSlot swallowed every error and returned null. That
  // made an RPC outage indistinguishable from a credential whose slot write never landed, so an orphan
  // looked like a blip and the caller told the user to retry — forever. A read that FAILED says nothing
  // about the wallet, and it must say so.
  const throwingRpc = {
    readContract: async () => {
      throw new HttpRequestError({ url: "http://127.0.0.1:1" });
    },
  } as unknown as Parameters<typeof createViemVaultReader>[0];
  const reader = createViemVaultReader(throwingRpc);
  await expect(reader.getAccessSlot(ADDR, SLOT)).rejects.toBeInstanceOf(VaultUnreadableError);
});

test("an UNDELEGATED account (zero data) resolves to null — that is an ORPHAN, not a network problem", async () => {
  // A fresh wallet has no code until its first transaction, so viem cannot decode a return value and
  // throws ContractFunctionZeroDataError. There is genuinely no access slot here, and retrying never makes one.
  const zeroDataRpc = {
    readContract: async () => {
      throw new ContractFunctionExecutionError(
        new ContractFunctionZeroDataError({ functionName: "getAccessSlot" }),
        { abi: [], functionName: "getAccessSlot" },
      );
    },
  } as unknown as Parameters<typeof createViemVaultReader>[0];
  const reader = createViemVaultReader(zeroDataRpc);
  expect(await reader.getAccessSlot(ADDR, SLOT)).toBeNull();
});

test("accessSlotCount propagates a read error (a count read, not a blob fall-through source)", async () => {
  const throwingRpc = {
    readContract: async () => {
      throw new Error("execution reverted");
    },
  } as unknown as Parameters<typeof createViemVaultReader>[0];
  const reader = createViemVaultReader(throwingRpc);
  await expect(reader.accessSlotCount!(ADDR)).rejects.toThrow(/reverted/);
});
